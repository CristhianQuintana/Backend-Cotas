export type UserRole = 'CUSTOMER' | 'OPERATOR' | 'ADMIN';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface UserRecord {
  id: string;
  username: string;
  role: UserRole;
  roles: UserRole[];
  status: UserStatus;
  mfaEnabled: boolean;
  mfaSecretCiphertext: string | null;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  sessionId: string;
}

const RANK: Record<UserRole, number> = { CUSTOMER: 1, OPERATOR: 2, ADMIN: 3 };

export function isUserRole(value: string): value is UserRole {
  return value === 'CUSTOMER' || value === 'OPERATOR' || value === 'ADMIN';
}

export function primaryRole(roles: readonly UserRole[]): UserRole {
  return roles.reduce<UserRole>(
    (best, role) => (RANK[role] > RANK[best] ? role : best),
    'CUSTOMER',
  );
}
