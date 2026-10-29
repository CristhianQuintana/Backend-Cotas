import type { XuiEpgEntry } from '../../integrations/xui/domain/models';

export interface EpgChannelGuide {
  streamId: string;
  generatedAt: string;
  now: XuiEpgEntry | null;
  next: XuiEpgEntry | null;
  items: XuiEpgEntry[];
}

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

function timeMs(iso: string | null): number | null {
  if (!iso) {
    return null;
  }
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}
