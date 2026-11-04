export const CATALOG_CACHE = Symbol('CATALOG_CACHE');

export interface CatalogCache {
  /** true si Redis (u otro backend) está disponible para lectura/escritura. */
  isEnabled(): boolean;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Comprueba conectividad. No lanza: false si no hay Redis o falló el ping. */
  ping(): Promise<boolean>;
}

export function catalogCacheKey(scope: string, resource: string): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 64);
  const safeResource = resource.replace(/[^a-zA-Z0-9._:-]/gu, '_').slice(0, 96);
  // v2: posterUrl/backdropUrl en catálogo; invalida entradas Redis anteriores.
  return `cotas:catalog:v2:${safeScope}:${safeResource}`;
}
