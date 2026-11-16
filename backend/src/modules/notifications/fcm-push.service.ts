import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SignJWT, importPKCS8 } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { LINE_ACCESS, type LineAccess } from '../identity/domain/ports/identity.ports';

@Injectable()
export class FcmPushService {
  private readonly logger = new Logger(FcmPushService.name);
  private accessToken: { value: string; expiresAtMs: number } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(LINE_ACCESS) private readonly lines?: LineAccess,
  ) {}

  /** Avisa a otros aparatos (p. ej. el celular) que un dispositivo cerró sesión. */
  async notifyDeviceSessionClosed(
    tokens: readonly string[],
    input: { deviceId: string; deviceName: string | null },
  ): Promise<void> {
    await this.notifyDeviceEvent(tokens, {
      type: 'device_session_closed',
      title: 'Sesión cerrada',
      body: `Se cerró la sesión en ${input.deviceName?.trim() || 'un dispositivo'}.`,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
    });
  }

  /** Aparato sigue vinculado pero sin uso reciente (app en background / TV apagada). */
  async notifyDeviceInactive(
    tokens: readonly string[],
    input: { deviceId: string; deviceName: string | null },
  ): Promise<void> {
    await this.notifyDeviceEvent(tokens, {
      type: 'device_inactive',
      title: 'Dispositivo inactivo',
      body: `${input.deviceName?.trim() || 'Un dispositivo'} está inactivo.`,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
    });
  }

  /** Nuevas películas/series detectadas por el sync de catálogo. */
  async notifyCatalogAnnouncements(
    tokens: readonly string[],
    input: { title: string; body: string; count: number; kinds: readonly string[] },
  ): Promise<void> {
    if (!this.config.fcmEnabled || tokens.length === 0) {
      return;
    }
    if (!this.config.fcmProjectId || !this.config.fcmClientEmail || !this.config.fcmPrivateKey) {
      this.logger.warn('FCM habilitado sin credenciales completas; se omiten envíos de catálogo.');
      return;
    }
    const bearer = await this.getAccessToken();
    const data = {
      type: 'catalog_announcement',
      count: String(input.count),
      kinds: input.kinds.join(','),
    };
    for (const token of tokens) {
      try {
        await this.send(bearer, token, input.title, input.body, data);
      } catch (error) {
        this.logger.warn(
          `FCM catalog_announcement falló: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
    }
  }

  private async notifyDeviceEvent(
    tokens: readonly string[],
    input: {
      type: string;
      title: string;
      body: string;
      deviceId: string;
      deviceName: string | null;
    },
  ): Promise<void> {
    if (!this.config.fcmEnabled || tokens.length === 0) {
      return;
    }
    if (!this.config.fcmProjectId || !this.config.fcmClientEmail || !this.config.fcmPrivateKey) {
      this.logger.warn('FCM habilitado sin credenciales completas; se omiten envíos.');
      return;
    }
    const bearer = await this.getAccessToken();
    for (const token of tokens) {
      try {
        await this.send(bearer, token, input.title, input.body, {
          type: input.type,
          deviceId: input.deviceId,
          deviceName: input.deviceName ?? '',
        });
      } catch (error) {
        this.logger.warn(
          `FCM ${input.type} falló: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
    }
  }

  private async send(
    bearer: string,
    token: string,
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<void> {
    const url = `https://fcm.googleapis.com/v1/projects/${this.config.fcmProjectId}/messages:send`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          android: {
            priority: 'HIGH',
            notification: {
              channelId: 'cotas_catalog',
              defaultSound: true,
            },
          },
          data,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text();
      if (isUnregisteredToken(response.status, text)) {
        await this.clearInvalidToken(token);
        throw new Error(`FCM token inválido: HTTP ${response.status}`);
      }
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
  }

  private async clearInvalidToken(token: string): Promise<void> {
    if (!this.lines?.clearPushTokenByValue) {
      return;
    }
    try {
      const cleared = await this.lines.clearPushTokenByValue(token);
      if (cleared > 0) {
        this.logger.warn(`Se invalidaron ${cleared} token(s) FCM obsoletos.`);
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo limpiar token FCM inválido: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAtMs > now + 60_000) {
      return this.accessToken.value;
    }
    const key = await importPKCS8(this.config.fcmPrivateKey!, 'RS256');
    const assertion = await this.signAssertion(key, now);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OAuth FCM HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new Error('OAuth FCM sin access_token');
    }
    this.accessToken = {
      value: payload.access_token,
      expiresAtMs: now + (payload.expires_in ?? 3600) * 1000,
    };
    return payload.access_token;
  }

  private async signAssertion(key: CryptoKey, now: number): Promise<string> {
    return new SignJWT({
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.config.fcmClientEmail!)
      .setSubject(this.config.fcmClientEmail!)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + 3600)
      .sign(key);
  }
}

function isUnregisteredToken(status: number, body: string): boolean {
  if (status === 404) {
    return true;
  }
  const lower = body.toLowerCase();
  return (
    lower.includes('unregistered') ||
    lower.includes('notfound') ||
    lower.includes('invalid-argument') ||
    lower.includes('registration-token-not-registered')
  );
}
