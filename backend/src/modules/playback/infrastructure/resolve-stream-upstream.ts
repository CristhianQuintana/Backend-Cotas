import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import {
  assertAllowedUpstreamUrl,
  isAllowedUpstreamUrl,
} from '../../../common/utils/allowed-upstream-host';

const MAX_HOPS = 5;

/**
 * Sigue redirects desde el host del panel (LAN) hasta una URL final.
 * Cada hop se revalida contra la allowlist; no se aceptan destinos fuera de ella.
 */
export async function resolveStreamUpstream(
  streamUrl: string,
  preferredLanHost: string | null,
  allowedHosts: readonly string[],
): Promise<string> {
  const start = preferredLanHost ? rewriteHost(streamUrl, preferredLanHost) : streamUrl;
  assertAllowedUpstreamUrl(start, mergeAllow(allowedHosts, preferredLanHost));
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    assertAllowedUpstreamUrl(current, mergeAllow(allowedHosts, preferredLanHost));
    const result = await headOrGet(current);
    if (result.status >= 300 && result.status < 400 && result.location) {
      const next = new URL(result.location, current);
      const allow = mergeAllow(allowedHosts, preferredLanHost);
      // Preferir path en host LAN (hairpin NAT) antes de seguir IP públicos allowlisted.
      if (preferredLanHost && next.hostname !== preferredLanHost.split(':')[0]) {
        const lanCandidate = rewriteHost(next.toString(), preferredLanHost);
        assertAllowedUpstreamUrl(lanCandidate, allow);
        try {
          const lanResult = await headOrGet(lanCandidate);
          if (lanResult.status >= 200 && lanResult.status < 300) {
            return lanCandidate;
          }
          if (lanResult.status >= 300 && lanResult.status < 400 && lanResult.location) {
            const again = new URL(lanResult.location, lanCandidate);
            if (!isAllowedUpstreamUrl(again, allow)) {
              // reescribir otra vez a LAN
              current = rewriteHost(again.toString(), preferredLanHost);
              continue;
            }
            current = again.toString();
            continue;
          }
        } catch {
          // Si LAN falla, solo seguir Location si el host está allowlisted.
        }
      }
      if (!isAllowedUpstreamUrl(next, allow)) {
        throw new Error('upstream_redirect_denied');
      }
      current = next.toString();
      continue;
    }
    if (result.status >= 200 && result.status < 400) {
      return current;
    }
    throw new Error(`upstream_status_${result.status}`);
  }
  throw new Error('upstream_redirect_loop');
}

function mergeAllow(allowedHosts: readonly string[], preferredLanHost: string | null): string[] {
  const set = new Set(allowedHosts.map((h) => h.trim()).filter(Boolean));
  if (preferredLanHost) {
    set.add(preferredLanHost);
    if (preferredLanHost.includes(':')) {
      set.add(preferredLanHost.split(':')[0]!);
    }
  }
  return [...set];
}

/** `host` puede ser `hostname` o `hostname:port` (puerto no estándar del panel). */
function rewriteHost(streamUrl: string, host: string): string {
  const url = new URL(streamUrl);
  const ipv6 = host.startsWith('[');
  if (!ipv6 && host.includes(':')) {
    const idx = host.lastIndexOf(':');
    url.hostname = host.slice(0, idx);
    url.port = host.slice(idx + 1);
  } else {
    url.hostname = host;
    url.port = '';
  }
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
      try {
        const absolute = new URL(trimmed, playlist).toString();
        return toProxySegUrl(endpoint, absolute);
      } catch {
        return line;
      }
    })
    .join('\n');
}

function toProxySegUrl(endpoint: string, absolute: string): string {
  const url = new URL(absolute);
  const path = `${url.pathname}${url.search}`;
  return `${endpoint}?p=${encodeURIComponent(path)}`;
}
