export type CatalogAnnouncementKind = 'vod' | 'series' | 'episode';

export interface CatalogContentItem {
  id: string;
  name: string;
  description?: string | null;
  posterUrl?: string | null;
  publishedAt?: Date | null;
  seriesId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}

export interface CatalogAnnouncementDraft extends CatalogContentItem {
  kind: CatalogAnnouncementKind;
  contentId: string;
  title: string;
  dedupeKey: string;
}

/** Stable identity includes the parent series because XUI episode IDs can be scoped. */
export function catalogDedupeKey(kind: CatalogAnnouncementKind, item: CatalogContentItem) {
  return `${kind}:${item.seriesId ?? ''}:${item.id}`;
}

/** Compares a complete successful XUI snapshot with the previous snapshot. */
export function diffNewCatalogItems(
  kind: CatalogAnnouncementKind,
  current: readonly CatalogContentItem[],
  previousIds: readonly string[],
): { nextIds: string[]; announcements: CatalogAnnouncementDraft[] } {
  const previous = new Set(previousIds);
  const valid = current.filter((item) => item.id && item.name?.trim());
  const nextIds = [...new Set(valid.map((item) => catalogDedupeKey(kind, item)))].sort();
  const announcements: CatalogAnnouncementDraft[] = [];
  for (const item of valid) {
    const dedupeKey = catalogDedupeKey(kind, item);
    if (previous.has(dedupeKey) || (kind !== 'episode' && previous.has(item.id))) continue;
    announcements.push({
      ...item,
      kind,
      contentId: item.id,
      title: item.name.trim().slice(0, 240),
      dedupeKey,
    });
    previous.add(dedupeKey);
    if (kind !== 'episode') previous.add(item.id);
  }
  return { nextIds, announcements };
}
