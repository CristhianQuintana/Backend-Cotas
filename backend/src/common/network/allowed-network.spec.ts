import {
  isAddressInCidrs,
  isValidCidr,
  normalizePeerAddress,
  resolveClientAddress,
} from './allowed-network';

describe('allowed-network', () => {
  const corporate = ['10.10.0.0/16'];

  it('acepta peers dentro del CIDR corporativo, incluido IPv4 mapeado en IPv6', () => {
    expect(isAddressInCidrs('10.10.0.31', corporate)).toBe(true);
    expect(isAddressInCidrs('10.10.200.7', corporate)).toBe(true);
    expect(isAddressInCidrs('::ffff:10.10.4.9', corporate)).toBe(true);
  });

  it('rechaza IP públicas, loopback y gateway Docker (tráfico vía Nginx)', () => {
    expect(isAddressInCidrs('192.141.98.18', corporate)).toBe(false);
    expect(isAddressInCidrs('127.0.0.1', corporate)).toBe(false);
    expect(isAddressInCidrs('172.18.0.1', corporate)).toBe(false);
    expect(isAddressInCidrs('10.11.0.1', corporate)).toBe(false);
    expect(isAddressInCidrs(null, corporate)).toBe(false);
    expect(isAddressInCidrs('no-es-ip', corporate)).toBe(false);
  });

  it('valida la sintaxis CIDR', () => {
    expect(isValidCidr('10.10.0.0/16')).toBe(true);
    expect(isValidCidr('192.168.1.5/32')).toBe(true);
    expect(isValidCidr('fd00::/8')).toBe(true);
    expect(isValidCidr('10.10.0.0')).toBe(false);
    expect(isValidCidr('10.10.0.0/33')).toBe(false);
    expect(isValidCidr('abc/8')).toBe(false);
    expect(isValidCidr('10.10.0.0/16/1')).toBe(false);
  });

  describe('resolveClientAddress', () => {
    const trusted = ['127.0.0.0/8', '::1/128', '172.16.0.0/12'];

    it('con proxy de confianza y flag activo usa la última entrada de X-Forwarded-For', () => {
      expect(
        resolveClientAddress({
          peerAddress: '172.18.0.1',
          forwardedFor: '10.10.3.44',
          trustForwarded: true,
          trustedProxyCidrs: trusted,
        }),
      ).toBe('10.10.3.44');
    });

    it('con el flag apagado ignora la cabecera', () => {
      expect(
        resolveClientAddress({
          peerAddress: '172.18.0.1',
          forwardedFor: '10.10.3.44',
          trustForwarded: false,
          trustedProxyCidrs: trusted,
        }),
      ).toBe('172.18.0.1');
    });

    it('un peer externo no puede imponer su X-Forwarded-For (anti-suplantación)', () => {
      expect(
        resolveClientAddress({
          peerAddress: '203.0.113.9',
          forwardedFor: '10.10.0.5',
          trustForwarded: true,
          trustedProxyCidrs: trusted,
        }),
      ).toBe('203.0.113.9');
    });

    it('descarta una cabecera inválida y conserva el peer', () => {
      expect(
        resolveClientAddress({
          peerAddress: '127.0.0.1',
          forwardedFor: 'no-es-ip',
          trustForwarded: true,
          trustedProxyCidrs: trusted,
        }),
      ).toBe('127.0.0.1');
    });
  });

  it('normaliza el peer', () => {
    expect(normalizePeerAddress('::ffff:10.10.0.5')).toBe('10.10.0.5');
    expect(normalizePeerAddress('')).toBeNull();
    expect(normalizePeerAddress('x')).toBeNull();
  });
});
