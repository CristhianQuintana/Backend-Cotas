import type { AccountReminderState } from '@prisma/client';
import { DomainError, ErrorCodes, PublicMessages } from '../../src/common/exceptions/domain-error';
import { isUuid, newId } from '../../src/common/utils/ids';
import type {
  CreateReminderInput,
  PatchReminderInput,
  ReminderView,
} from '../../src/modules/identity/application/use-cases/account-reminders.service';

const LEAD = new Set([5, 10, 15, 30, 60]);

interface Row {
  id: string;
  userId: string;
  channelId: string;
  channelName: string;
  programTitle: string;
  epgProgramId: string | null;
  programKey: string;
  leadMinutes: number;
  state: AccountReminderState;
  startAt: Date | null;
  endAt: Date | null;
  notifyAt: Date | null;
}

export class InMemoryAccountRemindersService {
  readonly rows: Row[] = [];

  async list(userId: string, now: Date): Promise<{ items: ReminderView[] }> {
    for (const row of this.rows) {
      if (row.userId === userId && row.state === 'scheduled' && row.endAt && row.endAt < now) {
        row.state = 'cancelled';
      }
    }
    return {
      items: this.rows
        .filter((row) => row.userId === userId && row.state === 'scheduled')
        .sort((a, b) => (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0))
        .map(toView),
    };
  }

  async create(userId: string, input: CreateReminderInput): Promise<ReminderView> {
    const leadMinutes = assertLead(input.leadMinutes);
    const channelId = input.channelId.trim();
    const channelName = input.channelName.trim();
    const programTitle = input.programTitle.trim();
    const epgProgramId = input.epgProgramId?.trim() || null;
    const startAt = parseDate(input.startAt);
    const endAt = parseDate(input.endAt);
    const programKey = (epgProgramId ?? programTitle).slice(0, 240);
    const existing = this.rows.find(
      (row) =>
        row.userId === userId &&
        row.state === 'scheduled' &&
        row.channelId === channelId &&
        row.programKey === programKey &&
        sameInstant(row.startAt, startAt),
    );
    if (existing) {
      return toView(existing);
    }
    const row: Row = {
      id: newId(),
      userId,
      channelId,
      channelName,
      programTitle,
      epgProgramId,
      programKey,
      leadMinutes,
      state: 'scheduled',
      startAt,
      endAt,
      notifyAt: startAt ? new Date(startAt.getTime() - leadMinutes * 60_000) : null,
    };
    this.rows.push(row);
    return toView(row);
  }

  async patch(userId: string, id: string, input: PatchReminderInput): Promise<ReminderView> {
    if (!isUuid(id)) {
      throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
    }
    const leadMinutes = assertLead(input.leadMinutes);
    const row = this.rows.find(
      (item) => item.id === id && item.userId === userId && item.state === 'scheduled',
    );
    if (!row) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    row.leadMinutes = leadMinutes;
    row.notifyAt = row.startAt ? new Date(row.startAt.getTime() - leadMinutes * 60_000) : null;
    return toView(row);
  }

  async cancel(userId: string, id: string): Promise<void> {
    if (!isUuid(id)) {
      throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
    }
    const row = this.rows.find(
      (item) => item.id === id && item.userId === userId && item.state === 'scheduled',
    );
    if (!row) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    row.state = 'cancelled';
  }
}

function toView(row: Row): ReminderView {
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
  if (!Number.isInteger(value) || !LEAD.has(value)) {
    throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
  }
  return value;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
  }
  return date;
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null && right === null) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.getTime() === right.getTime();
}
