export interface AuditDraft {
  action: string;
  result: 'success' | 'failure' | 'pending';
  actorUserId: string | null;
  correlationId: string | null;
  ipAddress: string | null;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AuditEventView {
  id: string;
  occurredAt: Date;
  action: string;
  result: string;
  actorUserId: string | null;
  correlationId: string | null;
}

export function sanitizeAuditMetadata(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!input) {
    return undefined;
  }
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/u.test(key)) {
      continue;
    }
    if (typeof value === 'string') {
      result[key] = value.replace(/[\r\n\t]/g, ' ').slice(0, 200);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      result[key] = value;
    }
  }
  return result;
}
