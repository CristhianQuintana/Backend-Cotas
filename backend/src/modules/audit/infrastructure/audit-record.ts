import { sanitizeAuditMetadata, type AuditDraft } from '../domain/audit-draft';
import { newId } from '../../../common/utils/ids';

export function auditCreateData(draft: AuditDraft) {
  const resourceType = draft.resourceType ?? draft.action.split('.')[0] ?? 'system';
  return {
    id: newId(),
    action: draft.action.slice(0, 64),
    result: draft.result,
    actorUserId: draft.actorUserId,
    resourceType: resourceType.slice(0, 64) || 'system',
    resourceId: draft.resourceId?.slice(0, 64) ?? null,
    correlationId: draft.correlationId?.slice(0, 64) ?? null,
    ipAddress: draft.ipAddress,
    metadata: sanitizeAuditMetadata(draft.metadata),
    createdAt: new Date(),
  };
}
