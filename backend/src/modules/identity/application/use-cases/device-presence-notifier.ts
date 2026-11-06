import { Inject, Injectable, Optional } from '@nestjs/common';
import { FcmPushService } from '../../../notifications/fcm-push.service';
import { LINE_ACCESS, type LineAccess } from '../../domain/ports/identity.ports';

/** Notifica a otros aparatos cuando uno cierra sesión o se revoca. */
@Injectable()
export class DevicePresenceNotifier {
  constructor(
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Optional() private readonly push?: FcmPushService,
  ) {}

  async notifySessionClosed(
    userId: string,
    closedDeviceId: string | null | undefined,
    deviceName: string | null | undefined,
  ): Promise<void> {
    if (!closedDeviceId || !this.push) {
      return;
    }
    const tokens = await this.lines.listPushTokens(userId, closedDeviceId);
    if (tokens.length === 0) {
      return;
    }
    await this.push.notifyDeviceSessionClosed(tokens, {
      deviceId: closedDeviceId,
      deviceName: deviceName ?? null,
    });
  }
}
