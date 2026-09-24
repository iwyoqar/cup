import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isExpenseCategoryType, isExpensePaymentStatus, isExpenseRecurrenceInterval } from '../../common/enums/finance';
import { CreateExpenseCategoryData, CreateExpenseData, FinanceRepository, UpdateExpenseCategoryData, UpdateExpenseData } from './finance.repository';

// Seeded once (idempotent — only inserted if the name doesn't already exist) so "configurable
// from Admin, not hardcoded in the frontend" still starts from the spec's own example list. Every
// one of these can be renamed/deactivated/added-to freely afterward; this is a starting point,
// never re-applied or enforced again.
const DEFAULT_CATEGORIES: { name: string; type: string }[] = [
  { name: 'Rent', type: 'OPERATING' },
  { name: 'Salaries', type: 'OPERATING' },
  { name: 'Utilities', type: 'OPERATING' },
  { name: 'Internet', type: 'OPERATING' },
  { name: 'Accounting', type: 'OPERATING' },
  { name: 'Software', type: 'OPERATING' },
  { name: 'Marketing', type: 'OPERATING' },
  { name: 'Repairs', type: 'OPERATING' },
  { name: 'Cleaning', type: 'OPERATING' },
  { name: 'Delivery', type: 'OPERATING' },
  { name: 'Bank/payment fees', type: 'FINANCIAL' },
  { name: 'Other', type: 'OPERATING' },
];

@Injectable()
export class FinanceExpenseService {
  constructor(private readonly repository: FinanceRepository) {}

  // ---- categories --------------------------------------------------------------------------------------------

  async listCategories(includeInactive = false) {
    const existing = await this.repository.findAllExpenseCategories(true);
    if (existing.length === 0) await this.seedDefaultCategories();
    return this.repository.findAllExpenseCategories(includeInactive);
  }

  private async seedDefaultCategories(): Promise<void> {
    for (const [index, c] of DEFAULT_CATEGORIES.entries()) {
      await this.repository.createExpenseCategory({ name: c.name, type: c.type, sortOrder: index }).catch(() => undefined); // unique-name race: another request already seeded it
    }
  }

  async createCategory(data: CreateExpenseCategoryData, actorId: string) {
    if (!isExpenseCategoryType(data.type)) throw new BadRequestException('Invalid category type.');
    const category = await this.repository.createExpenseCategory(data);
    await this.repository.recordAudit(actorId, 'FINANCE_EXPENSE_CATEGORY_CREATED', category.id);
    return category;
  }

  async updateCategory(id: string, data: UpdateExpenseCategoryData, actorId: string) {
    if (data.type !== undefined && !isExpenseCategoryType(data.type)) throw new BadRequestException('Invalid category type.');
    const existing = await this.repository.findExpenseCategoryById(id);
    if (!existing) throw new NotFoundException('Expense category not found.');
    const updated = await this.repository.updateExpenseCategory(id, data);
    await this.repository.recordAudit(actorId, 'FINANCE_EXPENSE_CATEGORY_UPDATED', id);
    return updated;
  }

  // ---- expenses ----------------------------------------------------------------------------------------------

  async list(args: { from?: Date; to?: Date; branchId?: string; categoryId?: string; cursor?: string; limit: number }) {
    return this.repository.listExpenses(args);
  }

  async create(data: CreateExpenseData) {
    this.validate(data);
    const category = await this.repository.findExpenseCategoryById(data.categoryId);
    if (!category) throw new BadRequestException('Unknown expense category.');
    const expense = await this.repository.createExpense(data);
    await this.repository.recordAudit(data.createdBy, 'FINANCE_EXPENSE_CREATED', expense.id);
    return expense;
  }

  async update(id: string, data: UpdateExpenseData, actorId: string) {
    if (data.amountMinor !== undefined && data.amountMinor <= 0) throw new BadRequestException('amountMinor must be positive.');
    if (data.paymentStatus !== undefined && !isExpensePaymentStatus(data.paymentStatus)) throw new BadRequestException('Invalid payment status.');
    if (data.recurrenceInterval !== undefined && data.recurrenceInterval !== null && !isExpenseRecurrenceInterval(data.recurrenceInterval)) throw new BadRequestException('Invalid recurrence interval.');
    const existing = await this.repository.findExpenseById(id);
    if (!existing) throw new NotFoundException('Expense not found.');
    if (data.categoryId) {
      const category = await this.repository.findExpenseCategoryById(data.categoryId);
      if (!category) throw new BadRequestException('Unknown expense category.');
    }
    const updated = await this.repository.updateExpense(id, data);
    await this.repository.recordAudit(actorId, 'FINANCE_EXPENSE_UPDATED', id);
    return updated;
  }

  async delete(id: string, actorId: string): Promise<void> {
    const existing = await this.repository.findExpenseById(id);
    if (!existing) throw new NotFoundException('Expense not found.');
    await this.repository.deleteExpense(id);
    await this.repository.recordAudit(actorId, 'FINANCE_EXPENSE_DELETED', id);
  }

  private validate(data: CreateExpenseData): void {
    if (data.amountMinor <= 0) throw new BadRequestException('amountMinor must be positive.');
    if (data.paymentStatus !== undefined && !isExpensePaymentStatus(data.paymentStatus)) throw new BadRequestException('Invalid payment status.');
    if (data.isRecurring && (!data.recurrenceInterval || !isExpenseRecurrenceInterval(data.recurrenceInterval))) throw new BadRequestException('A recurring expense needs a valid recurrenceInterval.');
    if (!data.isRecurring && data.recurrenceInterval) throw new BadRequestException('recurrenceInterval is only valid when isRecurring is true.');
  }
}
