import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCashAdjustmentData, FinanceRepository } from './finance.repository';

@Injectable()
export class FinanceCashAdjustmentService {
  constructor(private readonly repository: FinanceRepository) {}

  async create(data: CreateCashAdjustmentData, actorId: string) {
    if (data.amountMinor === 0) throw new BadRequestException('amountMinor cannot be zero — use a positive (cash in) or negative (cash out) value.');
    const adjustment = await this.repository.createCashAdjustment(data);
    await this.repository.recordAudit(actorId, 'FINANCE_CASH_ADJUSTMENT_CREATED', adjustment.id);
    return adjustment;
  }

  list(from: Date, to: Date) {
    return this.repository.listCashAdjustments(from, to);
  }
}
