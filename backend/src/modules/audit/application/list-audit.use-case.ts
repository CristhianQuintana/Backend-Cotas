import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_REPOSITORY, type AuditRepository } from '../domain/audit-repository';

@Injectable()
export class ListAuditUseCase {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {}

  execute(page: number, limit: number) {
    return this.audit.list(page, limit);
  }
}
