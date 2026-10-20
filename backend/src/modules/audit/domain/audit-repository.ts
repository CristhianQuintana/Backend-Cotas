import type { AuditDraft, AuditEventView } from './audit-draft';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditRepository {
  record(draft: AuditDraft): Promise<void>;
  list(page: number, limit: number): Promise<{ total: number; items: AuditEventView[] }>;
}
