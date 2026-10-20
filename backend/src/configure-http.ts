import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ValidationError } from 'class-validator';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { DomainError, ErrorCodes, PublicMessages } from './common/exceptions/domain-error';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { publicErrorBody } from './common/http/error-body';
import { isUuid } from './common/utils/ids';
import { RequestContext } from './common/logging/request-context';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { attachDevPreview } from './dev-preview';

export function configureHttp(app: INestApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix(config.apiPrefix);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-correlation-id');
    const correlationId = isUuid(incoming) ? incoming : randomUUID();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    RequestContext.run(correlationId, () => next());
  });
  app.use(helmet({ contentSecurityPolicy: config.swaggerEnabled ? false : undefined }));
  app.use(json({ limit: config.bodyLimit }));
  app.use(urlencoded({ extended: false, limit: config.bodyLimit }));
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
    const type =
      typeof error === 'object' && error !== null && 'type' in error ? String(error.type) : '';
    const correlationId = req.correlationId ?? 'unknown';
    if (status === 413 || type === 'entity.too.large') {
      res
        .status(413)
        .json(
          publicErrorBody(
            413,
            ErrorCodes.payloadTooLarge,
            PublicMessages.payloadTooLarge,
            correlationId,
          ),
        );
      return;
    }
    if (status === 400 && (type === 'entity.parse.failed' || error instanceof SyntaxError)) {
      res
        .status(400)
        .json(
          publicErrorBody(400, ErrorCodes.validation, PublicMessages.invalidJson, correlationId),
        );
      return;
    }
    next(error);
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentType = req.header('content-type');
    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      res
        .status(415)
        .json(
          publicErrorBody(
            415,
            ErrorCodes.unsupportedMedia,
            PublicMessages.unsupportedMedia,
            req.correlationId ?? 'unknown',
          ),
        );
      return;
    }
    next();
  });
  const server = app.getHttpAdapter().getInstance() as {
    disable: (name: string) => void;
    set: (name: string, value: number) => void;
    get: (path: string, handler: (req: Request, res: Response) => void) => void;
    post: (path: string, handler: (req: Request, res: Response) => void) => void;
    delete: (path: string, handler: (req: Request, res: Response) => void) => void;
  };
  server.disable('x-powered-by');
  if (config.nodeEnv !== 'production') {
    const playerPage = path.resolve(process.cwd(), 'dev/player.html');
    if (existsSync(playerPage)) {
      server.get('/dev/player', (_req, res) => {
        res.type('html').send(readFileSync(playerPage, 'utf8'));
      });
    }
    const audioScript = path.resolve(process.cwd(), 'dev/strip-mpeg-audio.js');
    if (existsSync(audioScript)) {
      server.get('/dev/strip-mpeg-audio.js', (_req, res) => {
        res.type('js').send(readFileSync(audioScript, 'utf8'));
      });
    }
    if (config.nodeEnv === 'development') {
      attachDevPreview(server, config);
    }
  }
  if (config.trustProxy) {
    server.set('trust proxy', 1);
  }
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Correlation-Id'],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors: ValidationError[]) =>
        new DomainError(ErrorCodes.validation, 400, PublicMessages.validation, flatten(errors)),
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  if (config.swaggerEnabled) {
    SwaggerModule.setup('api/docs', app, createSwaggerDocument(app));
  }
}

export function createSwaggerDocument(app: INestApplication) {
  const builder = new DocumentBuilder()
    .setTitle('COTAS Backend')
    .setDescription(
      'API de identidad, catálogo y autorización de reproducción. El vídeo no atraviesa esta API. Las referencias de reproducción pueden incluir material de acceso exigido por la infraestructura verificada y no deben registrarse.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, builder);
}

function flatten(errors: ValidationError[], parent = ''): { field: string; rules: string[] }[] {
  const result: { field: string; rules: string[] }[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      result.push({ field, rules: Object.keys(error.constraints) });
    }
    if (error.children && error.children.length > 0) {
      result.push(...flatten(error.children, field));
    }
  }
  return result;
}
