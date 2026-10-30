import type { XuiEpgEntry } from '../../integrations/xui/domain/models';

export type EpgProgramStatus = 'live' | 'upcoming' | 'ended';

export interface EpgChannelGuide {
  streamId: string;
  generatedAt: string;
  now: XuiEpgEntry | null;
  next: XuiEpgEntry | null;
  items: XuiEpgEntry[];
}

export interface EpgSearchHit {
  programId: string;
  title: string;
  description: string | null;
  streamId: string;
  channelName: string;
  channelIconUrl: string | null;
  startAt: string | null;
  endAt: string | null;
  startLocal: string | null;
  endLocal: string | null;
  /** Código estable para clientes. */
  status: EpgProgramStatus;
  /** Etiqueta en español (Samsung / UI). */
  statusLabel: 'en emisión' | 'próximo' | 'finalizado';
}

const LIMA_TZ = 'America/Lima';
const limaFormatter = new Intl.DateTimeFormat('es-PE', {
  timeZone: LIMA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function presentChannelEpg(
  streamId: string,
  items: XuiEpgEntry[],
  at: Date = new Date(),
): EpgChannelGuide {
  const ordered = [...items].sort((left, right) => {
    const leftMs = timeMs(left.startAt) ?? Number.POSITIVE_INFINITY;
    const rightMs = timeMs(right.startAt) ?? Number.POSITIVE_INFINITY;
    return leftMs - rightMs;
  });
  const nowMs = at.getTime();
  let now: XuiEpgEntry | null = null;
  let next: XuiEpgEntry | null = null;

  for (const item of ordered) {
    const startMs = timeMs(item.startAt);
    const endMs = timeMs(item.endAt);
    if (startMs !== null && endMs !== null && startMs <= nowMs && nowMs < endMs) {
      now = item;
      continue;
    }
    if (startMs !== null && startMs > nowMs) {
      next = item;
      break;
    }
  }

  if (!now && ordered.length > 0) {
    // Sin marcas de tiempo fiables: el primer ítem es lo más cercano a “en emisión”.
    const first = ordered[0] ?? null;
    now = first;
    next = ordered[1] ?? null;
  } else if (now && !next) {
    const index = ordered.findIndex((item) => item.id === now?.id);
    next = index >= 0 ? (ordered[index + 1] ?? null) : null;
  }

  return {
    streamId,
    generatedAt: at.toISOString(),
    now,
    next,
    items: ordered,
  };
}

export function programStatus(entry: XuiEpgEntry, at: Date = new Date()): EpgProgramStatus {
  const nowMs = at.getTime();
  const startMs = timeMs(entry.startAt);
  const endMs = timeMs(entry.endAt);
  if (startMs !== null && endMs !== null) {
    if (startMs <= nowMs && nowMs < endMs) {
      return 'live';
    }
    if (startMs > nowMs) {
      return 'upcoming';
    }
    return 'ended';
  }
  if (startMs !== null) {
    return startMs > nowMs ? 'upcoming' : 'ended';
  }
  return 'upcoming';
}

export function statusLabel(status: EpgProgramStatus): EpgSearchHit['statusLabel'] {
  switch (status) {
    case 'live':
      return 'en emisión';
    case 'upcoming':
      return 'próximo';
    case 'ended':
      return 'finalizado';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function formatLimaLocal(iso: string | null): string | null {
  const ms = timeMs(iso);
  if (ms === null) {
    return null;
  }
  // es-PE suele dar "dd/mm/yyyy, HH:mm" → unificar a "dd/mm/yyyy HH:mm".
  return limaFormatter.format(new Date(ms)).replace(',', '');
}

export function toSearchHit(
  entry: XuiEpgEntry,
  channel: { id: string; name: string; iconUrl: string | null },
  at: Date = new Date(),
): EpgSearchHit {
  const status = programStatus(entry, at);
  return {
    programId: entry.id,
    title: entry.title,
    description: entry.description,
    streamId: channel.id,
    channelName: channel.name,
    channelIconUrl: channel.iconUrl,
    startAt: entry.startAt,
    endAt: entry.endAt,
    startLocal: formatLimaLocal(entry.startAt),
    endLocal: formatLimaLocal(entry.endAt),
    status,
    statusLabel: statusLabel(status),
  };
}

export function sortSearchHits(hits: EpgSearchHit[]): EpgSearchHit[] {
  const rank: Record<EpgProgramStatus, number> = { live: 0, upcoming: 1, ended: 2 };
  return [...hits].sort((left, right) => {
    const byStatus = rank[left.status] - rank[right.status];
    if (byStatus !== 0) {
      return byStatus;
    }
    const leftStart = timeMs(left.startAt) ?? Number.POSITIVE_INFINITY;
    const rightStart = timeMs(right.startAt) ?? Number.POSITIVE_INFINITY;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return left.title.localeCompare(right.title, 'es', { sensitivity: 'base' });
  });
}

export function timeMs(iso: string | null): number | null {
  if (!iso) {
    return null;
  }
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}
