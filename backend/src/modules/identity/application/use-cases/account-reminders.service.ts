import { Injectable } from '@nestjs/common';
import type { AccountReminder, AccountReminderState } from '@prisma/client';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { isUuid, newId } from '../../../../common/utils/ids';
import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';
import { rethrowAsDomain } from '../../../../infrastructure/database/prisma-errors';

const LEAD_MINUTES = new Set([5, 10, 15, 30, 60]);

export interface ReminderView {
  id: string;
  channelId: string;
  channelName: string;
  programTitle: string;
  leadMinutes: number;
  state: AccountReminderState;
  epgProgramId: string | null;
  startAt: string | null;
  endAt: string | null;
  notifyAt: string | null;
}

export interface CreateReminderInput {
  channelId: string;
  channelName: string;
  programTitle: string;
  leadMinutes: number;
  epgProgramId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
}

export interface PatchReminderInput {
  leadMinutes: number;
}

@Injectable()
export class AccountRemindersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, now: Date): Promise<{ items: ReminderView[] }> {
    try {
      await this.expireEnded(userId, now);
      const rows = await this.prisma.accountReminder.findMany({
        where: { userId, state: 'scheduled' },
        orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      });
      return { items: rows.map(toView) };
    } catch (error) {
      bubble(error);
    }
  }

  async create(userId: string, input: CreateReminderInput): Promise<ReminderView> {
    try {
      const leadMinutes = assertLead(input.leadMinutes);
      const channelId = input.channelId.trim();
      const channelName = input.channelName.trim();
      const programTitle = input.programTitle.trim();
      const epgProgramId = normalizeOptional(input.epgProgramId);
      const startAt = parseOptionalDate(input.startAt);
      const endAt = parseOptionalDate(input.endAt);
      if (!channelId || !channelName || !programTitle) {
        throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
      }
      const programKey = (epgProgramId ?? programTitle).slice(0, 240);
      const notifyAt = computeNotifyAt(startAt, leadMinutes);

      const existing = await this.prisma.accountReminder.findFirst({
        where: {
          userId,
          channelId,
          programKey,
          startAt: startAt ?? null,
          state: 'scheduled',
        },
      });
      if (existing) {
        return toView(existing);
      }

      const created = await this.prisma.accountReminder.create({
        data: {
          id: newId(),
          userId,
          channelId: channelId.slice(0, 64),
          channelName: channelName.slice(0, 160),
          programTitle: programTitle.slice(0, 240),
          epgProgramId: epgProgramId?.slice(0, 64) ?? null,
          programKey,
          leadMinutes,
          state: 'scheduled',
          startAt,
          endAt,
          notifyAt,
        },
      });
      return toView(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const recovered = await this.findDuplicate(userId, input);
        if (recovered) {
          return toView(recovered);
        }
      }
      bubble(error);
    }
  }

  async patch(userId: string, id: string, input: PatchReminderInput): Promise<ReminderView> {
    try {
      assertId(id);
      const leadMinutes = assertLead(input.leadMinutes);
      const current = await this.prisma.accountReminder.findFirst({
        where: { id, userId, state: 'scheduled' },
      });
      if (!current) {
        throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
      }
      const updated = await this.prisma.accountReminder.update({
        where: { id: current.id },
        data: {
          leadMinutes,
          notifyAt: computeNotifyAt(current.startAt, leadMinutes),
        },
      });
      return toView(updated);
    } catch (error) {
      bubble(error);
    }
  }

  async cancel(userId: string, id: string): Promise<void> {
    try {
      assertId(id);
      const updated = await this.prisma.accountReminder.updateMany({
        where: { id, userId, state: 'scheduled' },
        data: { state: 'cancelled' },
      });
      if (updated.count !== 1) {
        throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
      }
    } catch (error) {
      bubble(error);
    }
  }

  private async expireEnded(userId: string, now: Date): Promise<void> {
    await this.prisma.accountReminder.updateMany({
      where: {
        userId,
        state: 'scheduled',
        endAt: { lt: now },
      },
      data: { state: 'cancelled' },
    });
  }

  private async findDuplicate(userId: string, input: CreateReminderInput) {
    const epgProgramId = normalizeOptional(input.epgProgramId);
    const programTitle = input.programTitle.trim();
    const programKey = (epgProgramId ?? programTitle).slice(0, 240);
    const startAt = parseOptionalDate(input.startAt);
    return this.prisma.accountReminder.findFirst({
      where: {
        userId,
        channelId: input.channelId.trim(),
        programKey,
        startAt: startAt ?? null,
        state: 'scheduled',
      },
    });
  }
}

function toView(row: AccountReminder): ReminderView {
  return {
    id: row.id,
    channelId: row.channelId,
    channelName: row.channelName,
    programTitle: row.programTitle,
    leadMinutes: row.leadMinutes,
    state: row.state,
    epgProgramId: row.epgProgramId,
    startAt: row.startAt?.toISOString() ?? null,
    endAt: row.endAt?.toISOString() ?? null,
    notifyAt: row.notifyAt?.toISOString() ?? null,
  };
}

function assertLead(value: number): number {
  if (!Number.isInteger(value) || !LEAD_MINUTES.has(value)) {
    throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
  }
  return value;
}

function assertId(id: string): void {
  if (!isUuid(id)) {
    throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
  }
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null || value.trim() === '') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
  }
  return date;
}

function computeNotifyAt(startAt: Date | null, leadMinutes: number): Date | null {
  if (!startAt) {
    return null;
  }
  return new Date(startAt.getTime() - leadMinutes * 60_000);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function bubble(error: unknown): never {
  if (error instanceof DomainError) {
    throw error;
  }
  rethrowAsDomain(error);
}
