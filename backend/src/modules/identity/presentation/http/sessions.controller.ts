import { Controller, Delete, Get, HttpCode, Inject, Param, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { requestMeta } from '../../../../common/logging/request-meta';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import {
  ListSessionsUseCase,
  RevokeSessionUseCase,
} from '../../application/use-cases/session.use-cases';
import { SessionIdParamDto } from './dto/auth.dto';

@ApiTags('sessions')
@ApiBearerAuth()
@Controller('sessions')
export class SessionsController {
  constructor(
    @Inject(ListSessionsUseCase) private readonly listSessions: ListSessionsUseCase,
    @Inject(RevokeSessionUseCase) private readonly revokeSession: RevokeSessionUseCase,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.listSessions.execute(user);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SessionIdParamDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.revokeSession.execute(user, params.id, requestMeta(req));
  }
}
