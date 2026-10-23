import type { Clock } from '../../../../common/utils/clock';
import { AdminUsersUseCase } from '../../application/use-cases/admin-users.use-case';
import type { PasswordHasher } from '../../domain/ports/identity.ports';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';

const meta = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

describe('AdminUsersUseCase', () => {
  const clock: Clock = { now: () => new Date('2026-10-23T15:00:00.000Z') };
  const passwords: PasswordHasher = {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify() {
      return true;
    },
    async dummyHash() {
      return 'dummy';
    },
  };

  it('crea, lista, actualiza estado y restablece contraseña sin devolver el hash', async () => {
    const identity = new InMemoryIdentity();
    const admin = addUser(identity, {
      username: 'admin.local',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: 'hash:admin-password-12',
      mfaEnabled: true,
      mfaSecretCiphertext: 'enc:SECRET',
    });
    const useCase = new AdminUsersUseCase(identity, passwords, identity, clock);
    const actor = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      sessionId: '11111111-1111-4111-8111-111111111111',
    };

    const created = await useCase.create(
      actor,
      {
        username: 'operador',
        password: 'local-operator-password',
        role: 'OPERATOR',
      },
      meta,
    );
    expect(created.username).toBe('operador');
    expect(created.role).toBe('OPERATOR');
    expect(created).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(created)).not.toContain('hash:');

    const listed = await useCase.list(1, 20);
    expect(listed.total).toBe(2);

    const suspended = await useCase.update(actor, created.id, { status: 'SUSPENDED' }, meta);
    expect(suspended.status).toBe('SUSPENDED');

    const reset = await useCase.resetPassword(actor, created.id, 'another-secure-pass', meta);
    expect(reset.username).toBe('operador');
    expect(identity.users.find((user) => user.id === created.id)?.passwordHash).toBe(
      'hash:another-secure-pass',
    );
  });

  it('impide que el admin se desactive a sí mismo', async () => {
    const identity = new InMemoryIdentity();
    const admin = addUser(identity, {
      username: 'admin.local',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: 'hash:admin-password-12',
      mfaEnabled: true,
      mfaSecretCiphertext: 'enc:SECRET',
    });
    const useCase = new AdminUsersUseCase(identity, passwords, identity, clock);
    await expect(
      useCase.update(
        {
          id: admin.id,
          username: admin.username,
          role: 'ADMIN',
          sessionId: '11111111-1111-4111-8111-111111111111',
        },
        admin.id,
        { status: 'DISABLED' },
        meta,
      ),
    ).rejects.toThrow('No puede desactivar su propia cuenta.');
  });

  it('rechaza contraseñas cortas', async () => {
    const identity = new InMemoryIdentity();
    const admin = addUser(identity, {
      username: 'admin.local',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: 'hash:admin-password-12',
      mfaEnabled: true,
      mfaSecretCiphertext: 'enc:SECRET',
    });
    const useCase = new AdminUsersUseCase(identity, passwords, identity, clock);
    await expect(
      useCase.create(
        {
          id: admin.id,
          username: admin.username,
          role: 'ADMIN',
          sessionId: '11111111-1111-4111-8111-111111111111',
        },
        { username: 'nuevo', password: 'corto', role: 'CUSTOMER' },
        meta,
      ),
    ).rejects.toThrow('La contraseña debe tener entre 12 y 128 caracteres.');
  });
});
