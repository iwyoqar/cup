import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { FinanceRecurringExpenseService } from './finance-recurring-expense.service';

@Injectable()
export class FinanceRecurringExpenseJob implements OnModuleInit {
  private readonly logger = new Logger(FinanceRecurringExpenseJob.name);

  constructor(
    private readonly service: FinanceRecurringExpenseService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      this.service.run().catch((err) => {
        this.logger.error(`Recurring expense tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.config.env.FINANCE_RECURRING_EXPENSE_INTERVAL_MS);
    interval.unref?.();
    this.schedulerRegistry.addInterval('finance-recurring-expense', interval);
  }
}
