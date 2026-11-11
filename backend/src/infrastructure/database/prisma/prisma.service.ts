import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { errorName, redactSensitive } from '../../../common/logging/redact';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: [] });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error(
        `PostgreSQL no disponible al iniciar (${errorName(error)}). ${redactSensitive(safeText(error))}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isDatabaseReachable(timeoutMs = 2_000): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('db_ready_timeout')), timeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

function safeText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }
  return 'error-desconocido';
}
