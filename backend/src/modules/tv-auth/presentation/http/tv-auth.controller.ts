import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { Public } from '../../../../common/decorators/public.decorator';
import { SensitiveRateLimitGuard } from '../../../../common/guards/sensitive-rate-limit.guard';
import { requestMeta } from '../../../../common/logging/request-meta';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';
import { TvAuthUseCase } from '../../application/tv-auth.use-case';
import {
  CreateTvQrSessionDto,
  TvQrCodeBodyDto,
  TvQrIdentifyDto,
  TvQrSessionParamDto,
} from './tv-auth.dto';
import { renderTvAuthorizePage, tvAuthorizeHeaders } from './tv-authorize.page';

/**
 * Login de televisores por QR. Rutas públicas: el televisor se autentica con el secreto de su
 * sesión (`Authorization: Bearer <pollSecret>`) y el teléfono con el código del QR + Google.
 */
@ApiTags('tv-auth')
@Controller('auth/tv/qr')
export class TvAuthController {
  constructor(
    @Inject(TvAuthUseCase) private readonly tvAuth: TvAuthUseCase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ── Televisor ────────────────────────────────────────────────────────────

  /** Crea una sesión QR. Devuelve la URL a codificar en el QR y el secreto de sondeo. */
  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('session')
  createSession(@Body() body: CreateTvQrSessionDto, @Req() req: Request) {
    return this.tvAuth.createSession(body, requestMeta(req));
  }

  /**
   * Estado de la sesión. Con `AUTHORIZED` entrega las credenciales UNA sola vez; después
   * responde `credentialsDelivered: true` sin tokens.
   */
  @Public()
  @ApiBearerAuth()
  @Get('session/:sessionId/status')
  status(
    @Param() params: TvQrSessionParamDto,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: Request,
  ) {
    return this.tvAuth.getStatus(
      { sessionId: params.sessionId, pollSecret: pollSecret(authorization) },
      requestMeta(req),
    );
  }

  /** El televisor cancela su sesión pendiente. */
  @Public()
  @ApiBearerAuth()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('session/:sessionId/cancel')
  cancel(
    @Param() params: TvQrSessionParamDto,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: Request,
  ) {
    return this.tvAuth.cancel(
      { sessionId: params.sessionId, pollSecret: pollSecret(authorization) },
      requestMeta(req),
    );
  }

  // ── Teléfono ─────────────────────────────────────────────────────────────

  /** Datos del televisor solicitante (la página los muestra antes de pedir Google). */
  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('session/:sessionId/info')
  info(@Param() params: TvQrSessionParamDto, @Body() body: TvQrCodeBodyDto) {
    return this.tvAuth.getInfo({ sessionId: params.sessionId, code: body.code });
  }

  /** Valida el ID token de Google y devuelve la cuenta que se vincularía (sin autorizar). */
  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('session/:sessionId/identify')
  identify(
    @Param() params: TvQrSessionParamDto,
    @Body() body: TvQrIdentifyDto,
    @Req() req: Request,
  ) {
    return this.tvAuth.identify(
      { sessionId: params.sessionId, code: body.code, idToken: body.idToken },
      requestMeta(req),
    );
  }

  /** Confirmación explícita del usuario: vincula la cuenta con esta sesión de televisor. */
  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('session/:sessionId/authorize')
  authorize(
    @Param() params: TvQrSessionParamDto,
    @Body() body: TvQrIdentifyDto,
    @Req() req: Request,
  ) {
    return this.tvAuth.authorize(
      { sessionId: params.sessionId, code: body.code, idToken: body.idToken },
      requestMeta(req),
    );
  }

  /** El usuario rechaza la solicitud desde el teléfono. */
  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('session/:sessionId/reject')
  reject(@Param() params: TvQrSessionParamDto, @Body() body: TvQrCodeBodyDto, @Req() req: Request) {
    return this.tvAuth.reject({ sessionId: params.sessionId, code: body.code }, requestMeta(req));
  }

  /** Página web que abre el teléfono al escanear el QR. */
  @Public()
  @ApiExcludeEndpoint()
  @Get('authorize/:sessionId')
  page(@Param() params: TvQrSessionParamDto, @Res() res: Response): void {
    const nonce = randomBytes(16).toString('base64');
    for (const [name, value] of Object.entries(tvAuthorizeHeaders(nonce))) {
      res.setHeader(name, value);
    }
    res
      .status(200)
      .type('html')
      .send(
        renderTvAuthorizePage({
          sessionId: params.sessionId,
          apiBase: `/${this.config.apiPrefix}`,
          googleClientId: this.config.googleSignInEnabled ? this.config.tvQrGoogleClientId : null,
          nonce,
        }),
      );
  }
}

function pollSecret(authorization: string | undefined): string {
  const match = /^Bearer\s+([0-9A-Za-z_-]{16,128})$/u.exec(authorization ?? '');
  if (!match) {
    throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
  }
  return match[1]!;
}
