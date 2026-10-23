import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../../common/logging/request-meta';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import { AUDIT_REPOSITORY, type AuditRepository } from '../../../audit/domain/audit-repository';
import {
  isStaffRole,
  isUserRole,
  toPublicUser,
  type AuthenticatedUser,
  type PublicUserView,
  type UserRole,
  type UserStatus,
} from '../../domain/models/authenticated-user';
import { assertPasswordAllowed } from '../../domain/policies/password.policy';
import {
  PASSWORD_HASHER,
  USER_REPOSITORY,
  type PasswordHasher,
  type UserRepository,
} from '../../domain/ports/identity.ports';

const STATUSES: readonly UserStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'];

@Injectable()
export class AdminUsersUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(
    page: number,
    limit: number,
  ): Promise<{
    items: PublicUserView[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    const result = await this.users.listUsers(page, limit);
    return {
      items: result.items.map(toPublicUser),
      page,
      limit,
      total: result.total,
      totalPages: result.total === 0 ? 0 : Math.ceil(result.total / limit),
    };
  }

  async get(id: string): Promise<PublicUserView> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    return toPublicUser(user);
  }

  async create(
    actor: AuthenticatedUser,
    input: { username: string; password: string; role: string; status?: string },
    meta: RequestMeta,
  ): Promise<PublicUserView> {
    const username = input.username.trim();
    const role = parseRole(input.role);
    const status = parseStatus(input.status ?? 'ACTIVE');
    assertPasswordAllowed(input.password, username);
    const existing = await this.users.findByUsername(username);
    if (existing) {
      throw new DomainError(ErrorCodes.conflict, 409, PublicMessages.conflict);
    }
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.createLocalUser({
      username,
      passwordHash,
      role,
      status,
      now: this.clock.now(),
    });
    await this.audit.record({
      action: 'admin.user.create',
      result: 'success',
      actorUserId: actor.id,
      resourceType: 'user',
      resourceId: user.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: { role, status },
    });
    return toPublicUser(user);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: { status?: string; role?: string },
    meta: RequestMeta,
  ): Promise<PublicUserView> {
    if (!input.status && !input.role) {
      throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
    }
    const current = await this.users.findById(id);
    if (!current) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    const status = input.status === undefined ? undefined : parseStatus(input.status);
    const role = input.role === undefined ? undefined : parseRole(input.role);
    if (actor.id === id && role && role !== current.role) {
      throw new DomainError(ErrorCodes.forbidden, 403, 'No puede cambiar su propio rol.');
    }
    if (actor.id === id && status && status !== 'ACTIVE') {
      throw new DomainError(ErrorCodes.forbidden, 403, 'No puede desactivar su propia cuenta.');
    }
    if (role && isStaffRole(role) && !current.passwordHash) {
      throw new DomainError(
        ErrorCodes.validation,
        400,
        'Asigne una contraseña local antes de promover el usuario a personal.',
      );
    }
    const user = await this.users.updateLocalUser({
      id,
      status,
      role,
      now: this.clock.now(),
    });
    await this.audit.record({
      action: 'admin.user.update',
      result: 'success',
      actorUserId: actor.id,
      resourceType: 'user',
      resourceId: id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: {
        status: status ?? null,
        role: role ?? null,
      },
    });
    return toPublicUser(user);
  }

  async resetPassword(
    actor: AuthenticatedUser,
    id: string,
    password: string,
    meta: RequestMeta,
  ): Promise<PublicUserView> {
    const current = await this.users.findById(id);
    if (!current) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    assertPasswordAllowed(password, current.username);
    const passwordHash = await this.passwords.hash(password);
    await this.users.setPasswordHash(id, passwordHash, this.clock.now());
    const user = await this.users.findById(id);
    if (!user) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    await this.audit.record({
      action: 'admin.user.reset_password',
      result: 'success',
      actorUserId: actor.id,
      resourceType: 'user',
      resourceId: id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
    });
    return toPublicUser(user);
  }
}

function parseRole(value: string): UserRole {
  if (!isUserRole(value)) {
    throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
  }
  return value;
}

function parseStatus(value: string): UserStatus {
  if (!(STATUSES as readonly string[]).includes(value)) {
    throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
  }
  return value as UserStatus;
}
