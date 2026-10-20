import { createServer, type Server } from 'node:http';
import { DomainError, ErrorCodes } from '../../../../../common/exceptions/domain-error';
import { XuiHttpClient } from '../../infrastructure/http/xui-http.client';

describe('XuiHttpClient', () => {
  const password = 'xui_test_password_not_real';

  async function listen(
    handler: (
      req: import('node:http').IncomingMessage,
      res: import('node:http').ServerResponse,
    ) => void,
  ) {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('puerto no disponible');
    }
    return { server, baseUrl: `http://127.0.0.1:${address.port}` };
  }

  function client(baseUrl: string, timeoutMs = 1000, maxResponseBytes = 200000) {
    return new XuiHttpClient({
      baseUrl,
      username: 'xui_test_user',
      password,
      timeoutMs,
      maxResponseBytes,
      allowedStreamHosts: ['127.0.0.1'],
    });
  }

  async function close(server: Server) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  it('normaliza categorías y no reintenta un error de autenticación', async () => {
    let calls = 0;
    const { server, baseUrl } = await listen((_req, res) => {
      calls += 1;
      res.statusCode = 401;
      res.end('no');
    });
    try {
      await expect(client(baseUrl).getLiveCategories()).rejects.toMatchObject({
        code: ErrorCodes.upstreamAuth,
      });
      expect(calls).toBe(1);
    } finally {
      await close(server);
    }
  });

  it('trata el 404 de una línea como credencial rechazada', async () => {
    const { server, baseUrl } = await listen((_req, res) => {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/html');
      res.end('<html>404</html>');
    });
    try {
      await expect(
        client(baseUrl).authenticate({ username: 'xui_test_user', password }),
      ).resolves.toEqual({ authenticated: false, status: null });
    } finally {
      await close(server);
    }
  });

  it('termina cuando el servidor no responde y luego puede consultar otro destino', async () => {
    const hanging = createServer(() => undefined);
    await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', resolve));
    const address = hanging.address();
    if (!address || typeof address === 'string') {
      throw new Error('puerto no disponible');
    }
    const started = Date.now();
    try {
      await expect(
        client(`http://127.0.0.1:${address.port}`, 300).getLiveStreams(),
      ).rejects.toMatchObject({
        code: ErrorCodes.dependencyTimeout,
      });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      hanging.closeAllConnections?.();
      await close(hanging);
    }

    const { server, baseUrl } = await listen((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ category_id: '1', category_name: 'Demo', parent_id: 0 }]));
    });
    try {
      await expect(client(baseUrl).getLiveCategories()).resolves.toEqual([
        { id: '1', name: 'Demo', parentId: null },
      ]);
    } finally {
      await close(server);
    }
  });

  it('rechaza JSON inválido, redirección y respuesta demasiado grande sin filtrar la contraseña', async () => {
    const cases: Array<(res: import('node:http').ServerResponse) => void> = [
      (res) => res.end('not-json'),
      (res) => {
        res.statusCode = 302;
        res.setHeader('location', 'http://evil.test/player_api.php');
        res.end();
      },
      (res) => res.end('x'.repeat(500)),
    ];
    for (const handler of cases) {
      const { server, baseUrl } = await listen((_req, res) => handler(res));
      try {
        const error = await client(baseUrl, 1000, 100)
          .getVodStreams()
          .then(
            () => null,
            (caught: unknown) => caught,
          );
        expect(error).toBeInstanceOf(DomainError);
        expect(error instanceof Error ? error.message : '').not.toContain(password);
      } finally {
        await close(server);
      }
    }
  });
});
