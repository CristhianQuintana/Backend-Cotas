import type { Request } from 'express';
import { RequestContext } from './request-context';
import { sanitizeIp, sanitizeLogValue } from './redact';

export interface RequestMeta {
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  const headerId = req.correlationId;
  return {
    correlationId: headerId ?? RequestContext.correlationId ?? 'unknown',
    ipAddress: sanitizeIp(req.ip),
    userAgent: sanitizeLogValue(req.header('user-agent') ?? '', 256) || null,
  };
}
