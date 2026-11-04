import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function signMedia(url: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${exp}.${url}`).digest('base64url');
}

export function buildSignedMediaUrl(input: {
  apiOrigin: string;
  apiPrefix: string;
  upstreamUrl: string;
  secret: string;
  ttlSeconds?: number;
}): string {
  const exp = Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 6 * 3600);
  const sig = signMedia(input.upstreamUrl, exp, input.secret);
  const u = encodeURIComponent(input.upstreamUrl);
  return `${input.apiOrigin}/${input.apiPrefix}/media/asset?u=${u}&exp=${exp}&sig=${sig}`;
}

export function signaturesEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
