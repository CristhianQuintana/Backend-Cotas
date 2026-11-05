import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SensitiveRateLimitGuard } from '../../../../common/guards/sensitive-rate-limit.guard';
import { requestMeta } from '../../../../common/logging/request-meta';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import { DeviceLinkUseCase } from '../../application/use-cases/device-link.use-case';
import {
  ApproveDeviceLinkDto,
  CreateDeviceLinkSessionDto,
  DeviceLinkCodeParamDto,
  PollDeviceLinkQueryDto,
} from './dto/device-link.dto';

@ApiTags('device-link')
@Controller('auth/device-link')
export class DeviceLinkController {
  constructor(@Inject(DeviceLinkUseCase) private readonly links: DeviceLinkUseCase) {}

  /** TV: crea código + payload QR y empieza a hacer poll. */
  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('session')
  createSession(@Body() body: CreateDeviceLinkSessionDto) {
    return this.links.createSession(body);
  }

  /** TV: consulta estado; si approved entrega tokens una sola vez. */
  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @Get('session/:code')
  poll(
    @Param() params: DeviceLinkCodeParamDto,
    @Query() query: PollDeviceLinkQueryDto,
    @Req() req: Request,
  ) {
    return this.links.poll(
      { linkCode: params.code.toUpperCase(), deviceId: query.deviceId },
      requestMeta(req),
    );
  }

  /** Móvil (Bearer): aprueba el código y registra el TV en /devices. */
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ApproveDeviceLinkDto,
    @Req() req: Request,
  ) {
    return this.links.approve(
      user,
      { linkCode: body.linkCode.toUpperCase(), deviceName: body.deviceName },
      requestMeta(req),
    );
  }
}
