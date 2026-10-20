import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SensitiveRateLimitGuard } from '../../../../common/guards/sensitive-rate-limit.guard';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { requestMeta } from '../../../../common/logging/request-meta';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import {
  BeginMfaEnrollmentUseCase,
  ConfirmMfaEnrollmentUseCase,
} from '../../application/use-cases/mfa.use-cases';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { GetProfileUseCase, LogoutUseCase } from '../../application/use-cases/session.use-cases';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import { ConfirmMfaRequestDto, LoginRequestDto, RefreshRequestDto } from './dto/auth.dto';

@ApiTags('identity')
@Controller('auth')
export class IdentityController {
  constructor(
    @Inject(LoginUseCase) private readonly loginUseCase: LoginUseCase,
    @Inject(RefreshSessionUseCase) private readonly refreshUseCase: RefreshSessionUseCase,
    @Inject(LogoutUseCase) private readonly logoutUseCase: LogoutUseCase,
    @Inject(GetProfileUseCase) private readonly profileUseCase: GetProfileUseCase,
    @Inject(BeginMfaEnrollmentUseCase) private readonly beginMfa: BeginMfaEnrollmentUseCase,
    @Inject(ConfirmMfaEnrollmentUseCase) private readonly confirmMfa: ConfirmMfaEnrollmentUseCase,
  ) {}

  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('login')
  login(@Body() body: LoginRequestDto, @Req() req: Request) {
    return this.loginUseCase.execute({ ...body, meta: requestMeta(req) });
  }

  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() body: RefreshRequestDto, @Req() req: Request) {
    return this.refreshUseCase.execute(body.refreshToken, requestMeta(req));
  }

  @ApiBearerAuth()
  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser, @Req() req: Request): Promise<void> {
    await this.logoutUseCase.execute(user, requestMeta(req));
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.profileUseCase.execute(user);
  }

  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('mfa/setup')
  setup(@Headers('authorization') authorization: string | undefined, @Req() req: Request) {
    return this.beginMfa.execute(bearer(authorization), requestMeta(req));
  }

  @Public()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('mfa/confirm')
  confirm(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ConfirmMfaRequestDto,
    @Req() req: Request,
  ) {
    return this.confirmMfa.execute(bearer(authorization), body.totpCode, requestMeta(req));
  }
}

function bearer(authorization: string | undefined): string {
  if (!authorization?.startsWith('Bearer ')) {
    throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
  }
  return token;
}
