import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import { AccountRemindersService } from '../../application/use-cases/account-reminders.service';
import {
  AccountReminderIdParamDto,
  CreateAccountReminderDto,
  PatchAccountReminderDto,
} from './dto/account-reminders.dto';

@ApiTags('account')
@ApiBearerAuth()
@Controller('account/reminders')
export class AccountRemindersController {
  constructor(
    @Inject(AccountRemindersService) private readonly reminders: AccountRemindersService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.reminders.list(user.id, this.clock.now());
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateAccountReminderDto) {
    return this.reminders.create(user.id, body);
  }

  @Patch(':id')
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AccountReminderIdParamDto,
    @Body() body: PatchAccountReminderDto,
  ) {
    return this.reminders.patch(user.id, params.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AccountReminderIdParamDto,
  ): Promise<void> {
    await this.reminders.cancel(user.id, params.id);
  }
}
