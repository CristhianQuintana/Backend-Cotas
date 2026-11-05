import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import { XUI_CLIENT, type XuiClient } from '../../../integrations/xui/domain/models';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import {
  LINE_ACCESS,
  type LineAccess,
  type SubscriptionSnapshot,
} from '../../domain/ports/identity.ports';

@Injectable()
export class GetSubscriptionUseCase {
  private readonly logger = new Logger(GetSubscriptionUseCase.name);

  constructor(
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(XUI_CLIENT) private readonly xui: XuiClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(user: AuthenticatedUser): Promise<SubscriptionSnapshot> {
    const credentials = await this.lines.credentialsFor(user.id);
    try {
      const line = await this.xui.getLineStatus(credentials);
      if (line.authenticated) {
        const now = this.clock.now();
        const snapshot = {
          displayName: line.displayName ?? credentials.username,
          expiresAt: line.expiresAt,
          maxConnections: line.maxConnections,
          activeConnections: line.activeConnections,
          status: line.status,
        };
        await this.lines.saveLineSnapshot(user.id, snapshot, now);
        await this.lines.enforceDeviceQuota(user.id, line.maxConnections, now, user.deviceId);
        const devices = await this.lines.listDevices(user.id, user.deviceId);
        const maxDevices = devices.limit ?? line.maxConnections;
        return {
          ...snapshot,
          username: line.username ?? credentials.username,
          lastVerifiedAt: now.toISOString(),
          source: 'live',
          maxDevices,
          activeDevices: devices.used,
          devicesUsed: devices.used,
          devicesLimit: maxDevices,
        };
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo refrescar la línea XUI para ${user.id}: ${
          error instanceof Error ? error.message : 'error'
        }`,
      );
    }

    const cached = await this.lines.getSubscriptionSnapshot(user.id);
    if (!cached) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    const devices = await this.lines.listDevices(user.id, user.deviceId);
    const maxDevices = devices.limit ?? cached.maxConnections;
    return {
      ...cached,
      maxDevices,
      activeDevices: devices.used,
      devicesUsed: devices.used,
      devicesLimit: maxDevices,
    };
  }
}
