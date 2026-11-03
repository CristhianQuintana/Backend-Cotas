import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const MAX_HOPS = 5;

/**
 * Sigue redirects desde el host del panel (LAN) hasta la URL final reproducible.
 * En pruebas el servidor API sí alcanza el IP público de XUI; los clientes LAN no.
 */
export async function resolveStreamUpstream(
  streamUrl: string,
  preferredLanHost: string | null,
): Promise<string> {
  const start = preferredLanHost ? rewriteHost(streamUrl, preferredLanHost) : streamUrl;
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const result = await headOrGet(current);
    if (result.status >= 300 && result.status < 400 && result.location) {
      current = new URL(result.location, current).toString();
      continue;
    }
    if (result.status >= 200 && result.status < 400) {
      return current;
    }
    throw new Error(`upstream_status_${result.status}`);
  }
  throw new Error('upstream_redirect_loop');
}

function rewriteHost(streamUrl: string, host: string): string {
  const url = new URL(streamUrl);
  url.hostname = host;
  url.port = '';
  return url.toString();
}

function headOrGet(target: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'User-Agent': 'COTAS-Playback-Resolver/1.0',
          Accept: '*/*',
          Connection: 'close',
        },
        timeout: 15000,
      },
      (res) => {
        res.resume();
        resolve({
          status: res.statusCode ?? 0,
          location: res.headers.location ?? null,
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('upstream_timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

export function rewritePlaylistForProxy(input: {
  body: string;
  playlistUrl: string;
  ticketId: string;
  publicApiBase: string;
}): string {
  const playlist = new URL(input.playlistUrl);
  const endpoint = `${input.publicApiBase}/playback/media/${input.ticketId}/seg`;
  return input.body
    .split(/\r?\n/u)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }
      if (trimmed.startsWith('#')) {
        if (!/URI="/iu.test(trimmed)) {
          return line;
        }
        return trimmed.replace(/URI="([^"]+)"/gu, (_match, raw: string) => {
          const absolute = new URL(raw, playlist).toString();
          return `URI="${toProxySegUrl(endpoint, absolute)}"`;
        });
      }
      const absolute = new URL(trimmed, playlist).toString();
      return toProxySegUrl(endpoint, absolute);
    })
    .join('\n');
}

/**
 * Usa query `p=` en lugar de path wildcard: los tokens HLS de XUI son muy largos
 * y el enrutado `/{*path}` terminaba pidiendo mal el upstream (404).
 */
function toProxySegUrl(endpoint: string, absoluteUrl: string): string {
  const target = new URL(absoluteUrl);
  const rest = `${target.pathname}${target.search}`;
  const path = rest.startsWith('/') ? rest : `/${rest}`;
  return `${endpoint}?p=${encodeURIComponent(path)}`;
}
