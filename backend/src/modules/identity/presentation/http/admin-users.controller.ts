import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { requestMeta } from '../../../../common/logging/request-meta';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import { AdminUsersUseCase } from '../../application/use-cases/admin-users.use-case';
import {
  AdminUserIdParamDto,
  AdminUserListQueryDto,
  CreateAdminUserDto,
  ResetAdminUserPasswordDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';

@ApiTags('admin-users')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(@Inject(AdminUsersUseCase) private readonly adminUsers: AdminUsersUseCase) {}

  @Get()
  list(@Query() query: AdminUserListQueryDto) {
    return this.adminUsers.list(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  get(@Param() params: AdminUserIdParamDto) {
    return this.adminUsers.get(params.id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAdminUserDto,
    @Req() req: Request,
  ) {
    return this.adminUsers.create(user, body, requestMeta(req));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AdminUserIdParamDto,
    @Body() body: UpdateAdminUserDto,
    @Req() req: Request,
  ) {
    return this.adminUsers.update(user, params.id, body, requestMeta(req));
  }

  @Post(':id/password')
  @HttpCode(200)
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AdminUserIdParamDto,
    @Body() body: ResetAdminUserPasswordDto,
    @Req() req: Request,
  ) {
    return this.adminUsers.resetPassword(user, params.id, body.password, requestMeta(req));
  }
}
