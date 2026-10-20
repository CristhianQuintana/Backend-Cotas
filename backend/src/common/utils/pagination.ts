export interface Page<T> {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: T[];
}

export function paginate<T>(items: readonly T[], page: number, limit: number): Page<T> {
  const start = (page - 1) * limit;
  return {
    page,
    limit,
    total: items.length,
    totalPages: items.length === 0 ? 0 : Math.ceil(items.length / limit),
    items: items.slice(start, start + limit),
  };
}
