import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PosterModule } from '../poster/poster.module';
import { PosterImportModule } from '../poster-import/poster-import.module';
import { FinanceCashAdjustmentService } from './finance-cash-adjustment.service';
import { FinanceCashFlowService } from './finance-cashflow.service';
import { FinanceCogsRepository } from './finance-cogs.repository';
import { FinanceCogsSyncJob } from './finance-cogs-sync.job';
import { FinanceCogsSyncService } from './finance-cogs-sync.service';
import { FinanceExpenseService } from './finance-expense.service';
import { FinanceInvestmentService } from './finance-investment.service';
import { FinanceLoanService } from './finance-loan.service';
import { FinancePnlRepository } from './finance-pnl.repository';
import { FinancePnlService } from './finance-pnl.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';
import { FinanceRecurringExpenseJob } from './finance-recurring-expense.job';
import { FinanceRecurringExpenseService } from './finance-recurring-expense.service';
import { FinanceTaxService } from './finance-tax.service';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';

@Module({
  imports: [AdminAuthModule, AnalyticsModule, PosterModule, PosterImportModule],
  controllers: [FinanceController],
  providers: [
    FinanceRepository,
    FinancePnlRepository,
    FinanceCogsRepository,
    FinanceCogsSyncService,
    FinanceCogsSyncJob,
    FinancePnlService,
    FinanceReconciliationService,
    FinanceCashFlowService,
    FinanceExpenseService,
    FinanceLoanService,
    FinanceTaxService,
    FinanceInvestmentService,
    FinanceCashAdjustmentService,
    FinanceRecurringExpenseService,
    FinanceRecurringExpenseJob,
  ],
})
export class FinanceModule {}
