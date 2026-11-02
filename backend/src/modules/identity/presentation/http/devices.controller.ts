import { Body, Controller, HttpCode, Inject, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, Length, Matches } from 'class-validator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import { RegisterPushTokenUseCase } from '../../application/use-cases/register-push-token.use-case';

class PushTokenDto {
  @IsString()
  @Length(20, 512)
  @Matches(/^[A-Za-z0-9_.:-]+$/u)
  token!: string;

  @IsString()
  @IsIn(['android', 'fcm', 'ios'])
  platform!: string;
}

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(
    @Inject(RegisterPushTokenUseCase) private readonly registerPush: RegisterPushTokenUseCase,
  ) {}

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
}
