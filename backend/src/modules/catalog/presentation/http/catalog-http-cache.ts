import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';

/** Sobrescribe el `Cache-Control: no-store` global en respuestas de catálogo cacheables. */
export function applyCatalogCacheHeaders(
  req: Request,
  res: Response,
  body: unknown,
  options?: { maxAgeSeconds?: number; privateCache?: boolean },
): 'not_modified' | 'ok' {
  const maxAge = options?.maxAgeSeconds ?? 60;
  const scope = options?.privateCache ? 'private' : 'public';
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const etag = `"${createHash('sha1').update(payload).digest('base64url')}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', `${scope}, max-age=${maxAge}`);
  res.removeHeader('Pragma');

  const inm = req.header('if-none-match');
  if (inm && inm === etag) {
    res.status(304);
    return 'not_modified';
  }
  return 'ok';
}
