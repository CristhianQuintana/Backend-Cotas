import { redactSensitive, sanitizeLogValue } from './redact';

describe('redactSensitive', () => {
  it('oculta credenciales de consulta, rutas de reproducción y bearer tokens', () => {
    const raw =
      'GET /player_api.php?username=line&password=secret http://host/live/line/secret/1001.m3u8 Authorization: Bearer abc.def.ghi';
    const redacted = redactSensitive(raw);
    expect(redacted).not.toContain('password=secret');
    expect(redacted).not.toContain('/live/line/secret/');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('abc.def.ghi');
  });

  it('elimina saltos de línea de valores controlados por el usuario', () => {
    expect(sanitizeLogValue('uno\nadmin=true\r\n')).toBe('uno admin=true  ');
  });
});
