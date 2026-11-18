import type { Request } from 'express';
import { RequestContext } from './request-context';
import { sanitizeIp, sanitizeLogValue } from './redact';

export interface RequestMeta {
  correlationId: string;
  ipAddress: string | null;
  /** Peer TCP directo (no `X-Forwarded-For`): no falsificable por el cliente. */
  peerAddress?: string | null;
  /** Última entrada de `X-Forwarded-For` (solo se usa si el peer es un proxy de confianza). */
  forwardedFor?: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  const headerId = req.correlationId;
  return {
    correlationId: headerId ?? RequestContext.correlationId ?? 'unknown',
    ipAddress: sanitizeIp(req.ip),
    peerAddress: sanitizeIp(req.socket?.remoteAddress),
    forwardedFor: sanitizeIp(
      (req.header('x-forwarded-for') ?? '').split(',').at(-1)?.trim() || undefined,
    ),
    userAgent: sanitizeLogValue(req.header('user-agent') ?? '', 256) || null,
  };
}
