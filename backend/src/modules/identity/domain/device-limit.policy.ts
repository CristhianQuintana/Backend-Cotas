/**
 * Política uniforme de cupo de dispositivos.
 * - `maxConnections` de XUI es la fuente de verdad cuando es un entero >= 1.
 * - `null`/ausente NO desactiva el cupo: se aplica `failsafe` (env DEVICE_LIMIT_FAILSAFE).
 * Nota: en COTAS el cupo controla dispositivos ACTIVE, no streams HTTP simultáneos de XUI.
 */
export function resolveDeviceLimit(
  xuiMaxConnections: number | null | undefined,
  failsafe: number,
): number {
  if (
    typeof xuiMaxConnections === 'number' &&
    Number.isFinite(xuiMaxConnections) &&
    xuiMaxConnections >= 1
  ) {
    return Math.trunc(xuiMaxConnections);
  }
  return Math.max(1, Math.trunc(failsafe));
}
