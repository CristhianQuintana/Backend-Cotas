export interface PublicErrorBody {
  statusCode: number;
  code: string;
  message: string;
  correlationId: string;
  details?: readonly { field: string; rules: string[] }[];
}

export function publicErrorBody(
  statusCode: number,
  code: string,
  message: string,
  correlationId: string,
  details?: readonly { field: string; rules: string[] }[],
): PublicErrorBody {
  return {
    statusCode,
    code,
    message,
    correlationId,
    ...(details && details.length > 0 ? { details } : {}),
  };
}
