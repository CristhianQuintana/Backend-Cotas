import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import { LINE_ACCESS, type LineAccess } from '../../domain/ports/identity.ports';

export interface RegisterPushTokenCommand {
  token: string;
  platform: string;
}

@Injectable()
export class RegisterPushTokenUseCase {
  constructor(
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(user: AuthenticatedUser, command: RegisterPushTokenCommand): Promise<void> {
    await this.lines.setPushToken(
      user.id,
      user.sessionId,
      command.token,
      command.platform,
      this.clock.now(),
    );
  }
}
