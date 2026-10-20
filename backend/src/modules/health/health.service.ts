import { Inject, Injectable } from '@nestjs/common';
import { DomainError, ErrorCodes, PublicMessages } from '../../common/exceptions/domain-error';
import { XUI_CLIENT, type XuiClient } from '../integrations/xui/domain/models';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(XUI_CLIENT) private readonly xui: XuiClient,
  ) {}

  live() {
    return { status: 'ok' as const };
  }

  async ready() {
    const database = await this.prisma.isDatabaseReachable();
    if (!database) {
      throw new DomainError(
        ErrorCodes.dependencyUnavailable,
        503,
        PublicMessages.databaseUnavailable,
      );
    }
    return { status: 'ok' as const, checks: { database: 'up' as const } };
  }

  async dependencies() {
    const database = await this.prisma.isDatabaseReachable();
    let xui: 'up' | 'down' = 'down';
    if (database) {
      try {
        const line = await this.xui.getLineStatus();
        xui = line.authenticated ? 'up' : 'down';
      } catch {
        xui = 'down';
      }
    }
    return {
      status: database && xui === 'up' ? ('ok' as const) : ('degraded' as const),
      checks: { database: database ? ('up' as const) : ('down' as const), xui },
    };
  }
}
