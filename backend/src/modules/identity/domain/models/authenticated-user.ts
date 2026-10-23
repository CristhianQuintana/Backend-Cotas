export type UserRole = 'CUSTOMER' | 'OPERATOR' | 'ADMIN';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface UserRecord {
  id: string;
  username: string;
  role: UserRole;
  roles: UserRole[];
  status: UserStatus;
  passwordHash: string | null;
  mfaEnabled: boolean;
  mfaSecretCiphertext: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface PublicUserView {
  id: string;
  username: string;
  role: UserRole;
  roles: UserRole[];
  status: UserStatus;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function toPublicUser(user: UserRecord): PublicUserView {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    roles: user.roles,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function isStaffRole(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'OPERATOR';
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
