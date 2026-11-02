import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import { GetSubscriptionUseCase } from '../../application/use-cases/subscription.use-case';

@ApiTags('account')
@ApiBearerAuth()
@Controller('account')
export class AccountController {
  constructor(
    @Inject(GetSubscriptionUseCase) private readonly subscription: GetSubscriptionUseCase,
  ) {}

  @Get('subscription')
  getSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.subscription.execute(user);
  }
}
