import { Injectable, Logger } from '@nestjs/common';
import { FinanceRepository } from './finance.repository';

const LEAD_DAYS = 3; // create the next month's row this many days before it's due, never after
const SYSTEM_ACTOR = 'system:recurring-expense-job';

function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const firstOfTarget = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const daysInTarget = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), Math.min(day, daysInTarget)));
}

// Finance-1 — a recurring expense is always a real, dated Expense row (see prisma/schema.prisma's
// comment on Expense.isRecurring); this job's only job is to create the NEXT month's row a few
// days ahead of when it's due, copying category/branch/description/amount from the latest
// occurrence in that series. It never edits or deletes a past row (an amount change only takes
// effect from the next auto-created occurrence onward — the owner edits/overrides any individual
// row afterward, same as any other expense), and is idempotent: findLatestRecurringExpense
// already being at-or-past the target date means nothing is created.
@Injectable()
export class FinanceRecurringExpenseService {
  private readonly logger = new Logger(FinanceRecurringExpenseService.name);

  constructor(private readonly repository: FinanceRepository) {}

  async run(now: Date = new Date()): Promise<{ created: number }> {
    const series = await this.repository.findAllRecurringSeries();
    let created = 0;
    for (const latest of series) {
      if (latest.recurrenceInterval !== 'MONTHLY') continue; // only interval currently supported (see finance.ts)
      const nextDue = addMonthsClamped(latest.date, 1);
      const createFrom = new Date(nextDue.getTime() - LEAD_DAYS * 86_400_000);
      if (now < createFrom) continue;
      // Re-check the LATEST row right before creating (another tick or a manual entry may have already advanced this series).
      const stillLatest = await this.repository.findLatestRecurringExpense(latest.categoryId, latest.description, latest.branchId);
      if (!stillLatest || stillLatest.date.getTime() !== latest.date.getTime()) continue;
      await this.repository.createExpense({
        categoryId: latest.categoryId,
        description: latest.description,
        amountMinor: latest.amountMinor,
        date: nextDue,
        branchId: latest.branchId,
        isRecurring: true,
        recurrenceInterval: 'MONTHLY',
        paymentStatus: 'UNPAID', // the owner marks it PAID once actually paid
        notes: latest.notes,
        createdBy: SYSTEM_ACTOR,
      });
      created += 1;
    }
    if (created > 0) this.logger.log(`Recurring expense job created ${created} new occurrence(s).`);
    return { created };
  }
}
