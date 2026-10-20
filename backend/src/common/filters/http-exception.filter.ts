import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, ErrorCodes, PublicMessages } from '../exceptions/domain-error';
import { publicErrorBody } from '../http/error-body';
import { errorName, redactSensitive } from '../logging/redact';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const correlationId = request.correlationId ?? 'unknown';
    const mapped = mapException(exception);
    if (mapped.statusCode >= 500) {
      this.logger.error(
        redactSensitive(
          JSON.stringify({
            correlationId,
            code: mapped.code,
            name: errorName(exception),
          }),
        ),
      );
    }
    response.status(mapped.statusCode).json(mapped.body(correlationId));
  }
}

function mapException(exception: unknown): {
  statusCode: number;
  code: string;
  body: (correlationId: string) => ReturnType<typeof publicErrorBody>;
} {
  if (exception instanceof DomainError) {
    return {
      statusCode: exception.statusCode,
      code: exception.code,
      body: (correlationId) =>
        publicErrorBody(
          exception.statusCode,
          exception.code,
          exception.message,
          correlationId,
          exception.details,
        ),
    };
  }
  const parserStatus = readStatus(exception);
  if (parserStatus === 413) {
    return simple(413, ErrorCodes.payloadTooLarge, PublicMessages.payloadTooLarge);
  }
  if (parserStatus === 400 && isJsonParseError(exception)) {
    return simple(400, ErrorCodes.validation, PublicMessages.invalidJson);
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === 429) {
      return simple(429, ErrorCodes.rateLimited, PublicMessages.rateLimited);
    }
    if (status === 404) {
      return simple(404, ErrorCodes.notFound, PublicMessages.notFound);
    }
    if (status === 400) {
      return simple(400, ErrorCodes.validation, PublicMessages.validation);
    }
    if (status === 401) {
      return simple(401, ErrorCodes.unauthorized, PublicMessages.unauthorized);
    }
    if (status === 403) {
      return simple(403, ErrorCodes.forbidden, PublicMessages.forbidden);
    }
    return simple(status >= 500 ? 500 : status, ErrorCodes.internal, PublicMessages.internal);
  }
  return simple(500, ErrorCodes.internal, PublicMessages.internal);
}

function simple(statusCode: number, code: string, message: string) {
  return {
    statusCode,
    code,
    body: (correlationId: string) => publicErrorBody(statusCode, code, message, correlationId),
  };
}

function readStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status;
  }
  return undefined;
}

function isJsonParseError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const type = 'type' in error ? String(error.type) : '';
  return type === 'entity.parse.failed' || error instanceof SyntaxError;
}
