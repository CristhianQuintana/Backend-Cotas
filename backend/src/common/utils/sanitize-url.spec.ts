import {
  clientFacingStreamServer,
  rewriteClientFacingXuiUrl,
  sanitizePublicUrl,
} from './sanitize-url';

const panelLan = ['10', '10', '0', '50'].join('.');
const publicPanel = 'cdn.panel.test';

describe('sanitize-url', () => {
  it('acepta http/https públicos sin credenciales', () => {
    expect(sanitizePublicUrl('http://cdn.test/img.png')).toBe('http://cdn.test/img.png');
    expect(sanitizePublicUrl('https://user:pass@cdn.test/img.png')).toBeNull();
  });

  it('reescribe hosts permitidos al origen LAN del panel', () => {
    const rewritten = rewriteClientFacingXuiUrl(
      `http://${publicPanel}:80/images/a.png`,
      `http://${panelLan}`,
      [panelLan, publicPanel],
    );
    expect(rewritten).toBe(`http://${panelLan}/images/a.png`);
  });

  it('no reescribe hosts ajenos a la lista', () => {
    expect(
      rewriteClientFacingXuiUrl('https://cdn.other/img.png', `http://${panelLan}`, [
        panelLan,
        publicPanel,
      ]),
    ).toBe('https://cdn.other/img.png');
  });

  it('expone el servidor de stream usable por el cliente', () => {
    expect(clientFacingStreamServer(`http://${panelLan}`, [panelLan])).toEqual({
      protocol: 'http',
      host: panelLan,
      port: '80',
    });
    expect(clientFacingStreamServer(`http://${panelLan}`, [publicPanel])).toBeNull();
  });
});
