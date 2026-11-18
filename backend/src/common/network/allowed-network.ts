import { BlockList, isIP } from 'node:net';

/** Quita el prefijo IPv4-mapeado (`::ffff:10.0.0.5`) que Node usa en sockets duales. */
export function normalizePeerAddress(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const clean = value.trim().replace(/^::ffff:/iu, '');
  return isIP(clean) === 0 ? null : clean;
}

export function isValidCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/');
  if (!address || prefix === undefined || rest.length > 0) {
    return false;
  }
  const family = isIP(address);
  if (family === 0 || !/^\d{1,3}$/u.test(prefix)) {
    return false;
  }
  const bits = Number(prefix);
  return bits >= 0 && bits <= (family === 4 ? 32 : 128);
}

/** Proxies locales de confianza por defecto: Nginx en el host (loopback) y gateway Docker. */
export const DEFAULT_TRUSTED_PROXY_CIDRS = ['127.0.0.0/8', '::1/128', '172.16.0.0/12'] as const;

/**
 * Dirección efectiva del cliente.
 * Siempre parte del peer TCP. Solo si `trustForwarded` está activo Y el peer es un proxy de
 * confianza se usa la ÚLTIMA entrada de `X-Forwarded-For` (la añadida por ese proxy).
 * Un peer que no es proxy de confianza nunca puede imponer su propia cabecera.
 */
export function resolveClientAddress(input: {
  peerAddress: string | null | undefined;
  forwardedFor: string | null | undefined;
  trustForwarded: boolean;
  trustedProxyCidrs: readonly string[];
}): string | null {
  const peer = normalizePeerAddress(input.peerAddress);
  if (!peer || !input.trustForwarded || !input.forwardedFor) {
    return peer;
  }
  if (!isAddressInCidrs(peer, input.trustedProxyCidrs)) {
    return peer;
  }
  const last = input.forwardedFor.split(',').at(-1)?.trim();
  return normalizePeerAddress(last) ?? peer;
}

/**
 * ¿La dirección pertenece a alguno de los rangos CIDR?
 * Lista vacía = sin restricción (función no aplicable; el llamador decide).
 */
export function isAddressInCidrs(address: string | null, cidrs: readonly string[]): boolean {
  const ip = normalizePeerAddress(address);
  if (!ip) {
    return false;
  }
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [network, prefix] = cidr.split('/');
    const family = isIP(network ?? '') === 6 ? 'ipv6' : 'ipv4';
    list.addSubnet(network as string, Number(prefix), family);
  }
  return list.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}
