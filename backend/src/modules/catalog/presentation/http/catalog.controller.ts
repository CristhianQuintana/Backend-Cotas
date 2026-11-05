import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';
import type { AuthenticatedUser } from '../../../identity/domain/models/authenticated-user';
import { LINE_ACCESS, type LineAccess } from '../../../identity/domain/ports/identity.ports';
import { mapPublicMediaFields } from '../../../media/application/public-media-url';
import { CatalogAnnouncementsService } from '../../application/catalog-announcements.service';
import { CatalogUseCase, toCatalogGridItem } from '../../application/catalog.use-case';
import { applyCatalogCacheHeaders } from './catalog-http-cache';
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
    @Inject(CatalogAnnouncementsService)
    private readonly announcements: CatalogAnnouncementsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('home')
  async home(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const view = await this.catalog.home(credentials);
    const signed = {
      ...view,
      heroes: view.heroes.map((item) => this.signItem(item, ['posterUrl'], req)),
      rails: view.rails.map((rail) => ({
        ...rail,
        items: rail.items.map((item) => this.signItem(item, ['posterUrl'], req)),
      })),
    };
    if (
      applyCatalogCacheHeaders(req, res, signed, {
        maxAgeSeconds: 60,
        privateCache: true,
      }) === 'not_modified'
    ) {
      return;
    }
    return signed;
  }

  @Get('announcements')
  listAnnouncements(@Query() query: CatalogQueryDto) {
    return this.announcements.list(query.page ?? 1, query.limit ?? 20);
  }

  @Get('live/categories')
  async liveCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CatalogQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const page = await this.catalog.liveCategories(normalize(query), credentials);
    return this.cached(req, res, page, 120);
  }

  @Get('live/streams')
  async liveStreams(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CatalogQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const page = await this.catalog.liveStreams(normalize(query), credentials);
    return this.cached(req, res, this.signGridPage(page, ['iconUrl', 'posterUrl'], req), 60);
  }

  @Get('vod/categories')
  async vodCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CatalogQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const page = await this.catalog.vodCategories(normalize(query), credentials);
    return this.cached(req, res, page, 120);
  }

  @Get('vod/streams')
  async vodStreams(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CatalogQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const page = await this.catalog.vodStreams(normalize(query), credentials);
    return this.cached(req, res, this.signGridPage(page, ['iconUrl', 'posterUrl'], req), 60);
  }

  @Get('vod/streams/:streamId')
  async vodDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: StreamIdParamDto,
    @Req() req: Request,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const details = await this.catalog.vodDetails(params.streamId, credentials);
    return this.signItem(details, ['posterUrl', 'backdropUrl', 'iconUrl'], req);
  }

  @Get('series/categories')
  async seriesCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CatalogQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const page = await this.catalog.seriesCategories(normalize(query), credentials);
    return this.cached(req, res, page, 120);
  }

  @Get('series')
  async series(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CatalogQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const page = await this.catalog.series(normalize(query), credentials);
    return this.cached(req, res, this.signGridPage(page, ['posterUrl'], req), 60);
  }

  @Get('series/:seriesId')
  async seriesDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SeriesIdParamDto,
    @Req() req: Request,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const details = await this.catalog.seriesDetails(params.seriesId, credentials);
    const signed = this.signItem(details, ['posterUrl', 'backdropUrl'], req);
    return {
      ...signed,
      seasons: details.seasons.map((season) => this.signItem(season, ['posterUrl'], req)),
      episodes: details.episodes.map((episode) => this.signItem(episode, ['posterUrl'], req)),
    };
  }

  @Get('series/:seriesId/seasons')
  async seasons(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SeriesIdParamDto,
    @Req() req: Request,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const result = await this.catalog.seasons(params.seriesId, credentials);
    return {
      ...result,
      items: result.items.map((season) => this.signItem(season, ['posterUrl'], req)),
    };
  }

  @Get('series/:seriesId/seasons/:seasonNumber/episodes')
  async episodes(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SeasonParamDto,
    @Req() req: Request,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const result = await this.catalog.episodes(
      params.seriesId,
      Number(params.seasonNumber),
      credentials,
    );
    return {
      ...result,
      items: result.items.map((episode) => this.signItem(episode, ['posterUrl'], req)),
    };
  }

  @Get('live/epg/search')
  async epgSearch(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EpgSearchQueryDto,
    @Req() req: Request,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const result = await this.catalog.searchEpg(
      {
        q: query.q,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      },
      credentials,
    );
    return this.signPage(result, ['channelIconUrl'], req);
  }

  @Get('live/epg')
  async epgBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EpgBatchQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credentials = await this.lines.credentialsFor(user.id);
    const streamIds = query.streamIds.split(',').map((id) => id.trim());
    const batch = await this.catalog.shortEpgBatch(streamIds, credentials, query.limit ?? 12);
    return this.cached(req, res, batch, 30, true);
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

  private cached(
    req: Request,
    res: Response,
    body: unknown,
    maxAgeSeconds: number,
    privateCache = true,
  ) {
    if (
      applyCatalogCacheHeaders(req, res, body, { maxAgeSeconds, privateCache }) === 'not_modified'
    ) {
      return;
    }
    return body;
  }

  private mediaCtx(req: Request) {
    return {
      publicApiBase: publicApiBaseFromRequest(req),
      secret: this.config.jwtAccessSecret,
      allowedHosts: this.config.xuiAllowedStreamHosts,
      ttlSeconds: this.config.mediaAssetTtlSeconds,
    };
  }

  private signItem<T>(item: T, keys: readonly string[], req: Request): T {
    return mapPublicMediaFields(item as Record<string, unknown>, keys, this.mediaCtx(req)) as T;
  }

  private signPage<T>(page: { items: T[] }, keys: readonly string[], req: Request) {
    return {
      ...page,
      items: page.items.map((item) => this.signItem(item, keys, req)),
    };
  }

  private signGridPage<T extends object>(
    page: { items: readonly T[]; page?: number; limit?: number; total?: number },
    keys: readonly string[],
    req: Request,
  ) {
    return {
      ...page,
      items: page.items.map((item) =>
        this.signItem(toCatalogGridItem(item as unknown as Record<string, unknown>), keys, req),
      ),
    };
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

function publicApiBaseFromRequest(req: Request): string {
  const host = req.get('host') || '127.0.0.1';
  const protoHeader = req.get('x-forwarded-proto');
  const protocol =
    protoHeader === 'https' || protoHeader === 'http'
      ? protoHeader
      : req.protocol === 'https'
        ? 'https'
        : 'http';
  const prefix = (req.baseUrl || '').split('/catalog')[0] || '/api/v1';
  return `${protocol}://${host}${prefix}`;
}
