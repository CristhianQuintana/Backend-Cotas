import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import { DevicePresenceNotifier } from '../../application/use-cases/device-presence-notifier';
import { RegisterPushTokenUseCase } from '../../application/use-cases/register-push-token.use-case';
import { LINE_ACCESS, type LineAccess } from '../../domain/ports/identity.ports';

class PushTokenDto {
  @IsString()
  @Length(20, 512)
  @Matches(/^[A-Za-z0-9_.:-]+$/u)
  token!: string;

  @IsString()
  @IsIn(['android', 'fcm', 'ios'])
  platform!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  deviceModel?: string;
}

class DeviceIdParamDto {
  @IsUUID('4')
  id!: string;
}

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(
    @Inject(RegisterPushTokenUseCase) private readonly registerPush: RegisterPushTokenUseCase,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(DevicePresenceNotifier) private readonly presence: DevicePresenceNotifier,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.lines.listDevices(user.id, user.deviceId);
  }

  /**
   * App en primer plano: marca este aparato como online.
   * TV/móvil deben llamar cada ~60 s mientras la app esté en uso.
   */
  @Post('heartbeat')
  @HttpCode(204)
  async heartbeat(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    if (!user.deviceId) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    const result = await this.lines.touchDevicePresence(user.id, user.deviceId, this.clock.now());
    if (result === 'not_found') {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
  }

  @Put('push-token')
  @HttpCode(204)
  async putPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PushTokenDto,
  ): Promise<void> {
    await this.registerPush.execute(user, {
      token: body.token,
      platform: body.platform === 'fcm' ? 'android' : body.platform,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: DeviceIdParamDto,
  ): Promise<void> {
    const before = await this.lines.listDevices(user.id, user.deviceId);
    const target = before.items.find((item) => item.id === params.id);
    const result = await this.lines.revokeDevice(params.id, user.id, this.clock.now());
    if (result === 'not_found') {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    await this.presence.notifySessionClosed(user.id, params.id, target?.deviceName ?? null);
  }
}
