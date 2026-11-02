import {
  clientFacingStreamServer,
  rewriteClientFacingXuiUrl,
  sanitizePublicUrl,
} from './sanitize-url';

describe('sanitize-url', () => {
  it('acepta http/https públicos sin credenciales', () => {
    expect(sanitizePublicUrl('http://cdn.test/img.png')).toBe('http://cdn.test/img.png');
    expect(sanitizePublicUrl('https://user:pass@cdn.test/img.png')).toBeNull();
  });

  it('reescribe hosts permitidos al origen LAN del panel', () => {
    const rewritten = rewriteClientFacingXuiUrl(
      'http://192.141.98.91:80/images/a.png',
      'http://10.10.0.100',
      ['10.10.0.100', '192.141.98.91'],
    );
    expect(rewritten).toBe('http://10.10.0.100/images/a.png');
  });

  it('no reescribe hosts ajenos a la lista', () => {
    expect(
      rewriteClientFacingXuiUrl('https://cdn.other/img.png', 'http://10.10.0.100', [
        '10.10.0.100',
        '192.141.98.91',
      ]),
    ).toBe('https://cdn.other/img.png');
  });

  it('expone el servidor de stream usable por el cliente', () => {
    expect(clientFacingStreamServer('http://10.10.0.100', ['10.10.0.100'])).toEqual({
      protocol: 'http',
      host: '10.10.0.100',
      port: '80',
    });
    expect(clientFacingStreamServer('http://10.10.0.100', ['192.141.98.91'])).toBeNull();
  });
});
