import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SensitiveRateLimitGuard } from '../../../../common/guards/sensitive-rate-limit.guard';
import { requestMeta } from '../../../../common/logging/request-meta';
import type { AuthenticatedUser } from '../../../identity/domain/models/authenticated-user';
import { AuthorizePlaybackUseCase } from '../../application/authorize-playback.use-case';
import { AuthorizePlaybackDto } from './dto/authorize-playback.dto';

@ApiTags('playback')
@ApiBearerAuth()
@Controller('playback')
export class PlaybackController {
  constructor(
    @Inject(AuthorizePlaybackUseCase) private readonly authorizePlayback: AuthorizePlaybackUseCase,
  ) {}

  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('authorizations')
  authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AuthorizePlaybackDto,
    @Req() req: Request,
  ) {
    return this.authorizePlayback.execute(
      user,
      {
        contentType: body.contentType,
        streamId: body.streamId,
        seriesId: body.seriesId,
        seasonNumber: body.seasonNumber,
      },
      requestMeta(req),
    );
  }
}
