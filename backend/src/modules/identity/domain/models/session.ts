export type RevocationReason = 'LOGOUT' | 'ROTATED' | 'REUSE' | 'ADMIN' | 'SECURITY';

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: RevocationReason | null;
  replacedById: string | null;
  createdAt: Date;
  userAgent: string | null;
}

export type RotateResult =
  | { type: 'rotated'; userId: string; sessionId: string }
  | { type: 'not_found' }
  | { type: 'expired' }
  | { type: 'reuse' };
