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
