import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { PageQueryDto } from '../../../../common/dto/page-query.dto';
import { ListAuditUseCase } from '../../application/list-audit.use-case';

@ApiTags('audit')
@ApiBearerAuth()
@Roles('OPERATOR')
@Controller('audit')
export class AuditController {
  constructor(@Inject(ListAuditUseCase) private readonly listAudit: ListAuditUseCase) {}

  @Get('events')
  events(@Query() query: PageQueryDto) {
    return this.listAudit.execute(query.page ?? 1, query.limit ?? 20);
  }
}
