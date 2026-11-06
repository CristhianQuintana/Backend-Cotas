import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { FcmPushService } from '../../../notifications/fcm-push.service';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import { LINE_ACCESS, type LineAccess } from '../../domain/ports/identity.ports';

/** Notifica a otros aparatos cuando uno cierra sesión o queda inactivo. */
@Injectable()
export class DevicePresenceNotifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DevicePresenceNotifier.name);
  private scanning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly push?: FcmPushService,
  ) {}

  onModuleInit(): void {
    // Cada 60 s: aparatos sin heartbeat → push `device_inactive` (una sola vez por ciclo offline).
    this.timer = setInterval(() => {
      void this.scanInactiveDevices();
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

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

  async scanInactiveDevices(): Promise<void> {
    if (this.scanning || !this.push) {
      return;
    }
    this.scanning = true;
    try {
      const newly = await this.lines.claimNewlyInactiveDevices(this.clock.now(), 40);
      for (const item of newly) {
        const tokens = await this.lines.listPushTokens(item.userId, item.deviceId);
        if (tokens.length === 0) {
          continue;
        }
        await this.push.notifyDeviceInactive(tokens, {
          deviceId: item.deviceId,
          deviceName: item.deviceName,
        });
      }
      if (newly.length > 0) {
        this.logger.log(`Presencia: ${newly.length} dispositivo(s) marcados inactivos.`);
      }
    } catch (error) {
      this.logger.warn(
        `Escaneo de inactividad falló: ${error instanceof Error ? error.message : 'error'}`,
      );
    } finally {
      this.scanning = false;
    }
  }
}
