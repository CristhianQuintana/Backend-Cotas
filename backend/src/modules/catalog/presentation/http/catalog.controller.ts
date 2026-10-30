import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../identity/domain/models/authenticated-user';
import { LINE_ACCESS, type LineAccess } from '../../../identity/domain/ports/identity.ports';
import { CatalogUseCase } from '../../application/catalog.use-case';
import {
  CatalogQueryDto,
  EpgBatchQueryDto,
  EpgQueryDto,
  EpgSearchQueryDto,
  SeasonParamDto,
  SeriesIdParamDto,
  StreamIdParamDto,
} from './dto/catalog-query.dto';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(CatalogUseCase) private readonly catalog: CatalogUseCase,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
  ) {}

  @Get('live/categories')
  async liveCategories(@CurrentUser() user: AuthenticatedUser, @Query() query: CatalogQueryDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.liveCategories(normalize(query), credentials);
  }

  @Get('live/streams')
  async liveStreams(@CurrentUser() user: AuthenticatedUser, @Query() query: CatalogQueryDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.liveStreams(normalize(query), credentials);
  }

  @Get('vod/categories')
  async vodCategories(@CurrentUser() user: AuthenticatedUser, @Query() query: CatalogQueryDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.vodCategories(normalize(query), credentials);
  }

  @Get('vod/streams')
  async vodStreams(@CurrentUser() user: AuthenticatedUser, @Query() query: CatalogQueryDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.vodStreams(normalize(query), credentials);
  }

  @Get('vod/streams/:streamId')
  async vodDetails(@CurrentUser() user: AuthenticatedUser, @Param() params: StreamIdParamDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.vodDetails(params.streamId, credentials);
  }

  @Get('series/categories')
  async seriesCategories(@CurrentUser() user: AuthenticatedUser, @Query() query: CatalogQueryDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.seriesCategories(normalize(query), credentials);
  }

  @Get('series')
  async series(@CurrentUser() user: AuthenticatedUser, @Query() query: CatalogQueryDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.series(normalize(query), credentials);
  }

  @Get('series/:seriesId')
  async seriesDetails(@CurrentUser() user: AuthenticatedUser, @Param() params: SeriesIdParamDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.seriesDetails(params.seriesId, credentials);
  }

  @Get('series/:seriesId/seasons')
  async seasons(@CurrentUser() user: AuthenticatedUser, @Param() params: SeriesIdParamDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.seasons(params.seriesId, credentials);
  }

  @Get('series/:seriesId/seasons/:seasonNumber/episodes')
  async episodes(@CurrentUser() user: AuthenticatedUser, @Param() params: SeasonParamDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.episodes(params.seriesId, Number(params.seasonNumber), credentials);
  }

  @Get('live/epg/search')
  async epgSearch(@CurrentUser() user: AuthenticatedUser, @Query() query: EpgSearchQueryDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.searchEpg(
      {
        q: query.q,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      },
      credentials,
    );
  }

  @Get('live/epg')
  async epgBatch(@CurrentUser() user: AuthenticatedUser, @Query() query: EpgBatchQueryDto) {
    const credentials = await this.lines.credentialsFor(user.id);
    const streamIds = query.streamIds.split(',').map((id) => id.trim());
    return this.catalog.shortEpgBatch(streamIds, credentials, query.limit ?? 12);
  }

  @Get('live/streams/:streamId/epg')
  async epg(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: StreamIdParamDto,
    @Query() query: EpgQueryDto,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    return this.catalog.shortEpg(params.streamId, credentials, query.limit ?? 12);
  }
}

function normalize(query: CatalogQueryDto) {
  return {
    page: query.page ?? 1,
    limit: query.limit ?? 20,
    categoryId: query.categoryId,
    search: query.search?.trim() || undefined,
  };
}
