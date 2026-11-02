export type CatalogAnnouncementKind = 'vod' | 'series';

export interface CatalogContentItem {
  id: string;
  name: string;
}

export interface CatalogAnnouncementDraft {
  kind: CatalogAnnouncementKind;
  contentId: string;
  title: string;
}

/** Compara IDs actuales con el snapshot previo; solo IDs nuevos generan anuncios. */
export function diffNewCatalogItems(
  kind: CatalogAnnouncementKind,
  current: readonly CatalogContentItem[],
  previousIds: readonly string[],
): { nextIds: string[]; announcements: CatalogAnnouncementDraft[] } {
  const previous = new Set(previousIds);
  const nextIds = [...new Set(current.map((item) => item.id).filter(Boolean))].sort();
  const announcements: CatalogAnnouncementDraft[] = [];
  for (const item of current) {
    if (!item.id || previous.has(item.id)) {
      continue;
    }
    const title = item.name.trim().slice(0, 240) || `Nuevo ${kind} ${item.id}`;
    announcements.push({ kind, contentId: item.id, title });
    previous.add(item.id);
  }
  return { nextIds, announcements };
}
