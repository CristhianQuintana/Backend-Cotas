import { DomainError } from '../../../../common/exceptions/domain-error';
import { AccountRemindersService } from '../../application/use-cases/account-reminders.service';

describe('AccountRemindersService (cálculo e idempotencia en memoria)', () => {
  it('calcula notifyAt = startAt - leadMinutes', async () => {
    const store = memoryPrisma();
    const service = new AccountRemindersService(store as never);
    const created = await service.create('user-1', {
      channelId: '10',
      channelName: 'Demo',
      programTitle: 'Serie',
      leadMinutes: 10,
      startAt: '2026-11-02T20:00:00.000Z',
      endAt: '2026-11-02T21:00:00.000Z',
    });
    expect(created.notifyAt).toBe('2026-11-02T19:50:00.000Z');
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('reusa el mismo recordatorio scheduled en creación duplicada', async () => {
    const store = memoryPrisma();
    const service = new AccountRemindersService(store as never);
    const input = {
      channelId: '10',
      channelName: 'Demo',
      programTitle: 'Serie',
      leadMinutes: 5,
      epgProgramId: 'ep-1',
      startAt: '2026-11-02T20:00:00.000Z',
    };
    const first = await service.create('user-1', input);
    const second = await service.create('user-1', input);
    expect(second.id).toBe(first.id);
    expect(store.rows).toHaveLength(1);
  });

  it('no permite leadMinutes inválidos', async () => {
    const service = new AccountRemindersService(memoryPrisma() as never);
    await expect(
      service.create('user-1', {
        channelId: '10',
        channelName: 'Demo',
        programTitle: 'Serie',
        leadMinutes: 7,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

function memoryPrisma() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    accountReminder: {
      async findMany(args: { where: { userId: string; state: string } }) {
        return rows.filter(
          (row) => row.userId === args.where.userId && row.state === args.where.state,
        );
      },
      async findFirst(args: {
        where: {
          userId: string;
          channelId: string;
          programKey: string;
          startAt: Date | null;
          state: string;
        };
      }) {
        return (
          rows.find((row) => {
            const start = row.startAt as Date | null;
            const want = args.where.startAt;
            const sameStart =
              start === null && want === null
                ? true
                : start instanceof Date &&
                  want instanceof Date &&
                  start.getTime() === want.getTime();
            return (
              row.userId === args.where.userId &&
              row.channelId === args.where.channelId &&
              row.programKey === args.where.programKey &&
              row.state === args.where.state &&
              sameStart
            );
          }) ?? null
        );
      },
      async create(args: { data: Record<string, unknown> }) {
        rows.push({ ...args.data });
        return args.data;
      },
      async update() {
        throw new Error('not used');
      },
      async updateMany() {
        return { count: 0 };
      },
    },
  };
}
