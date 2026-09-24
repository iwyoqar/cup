import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isTaxCalculationBase } from '../../common/enums/finance';
import { CreateTaxRuleData, FinanceRepository, UpdateTaxRuleData } from './finance.repository';

// Finance-1 — pure CRUD + validation. This is an accounting calculation engine, not legal advice:
// the exact Uzbek tax treatment is left to the owner to configure (rate, base, effective dates),
// never embedded as a hardcoded assumption — see the spec's own "do not present as legally
// verified Uzbek tax advice" instruction.
@Injectable()
export class FinanceTaxService {
  constructor(private readonly repository: FinanceRepository) {}

  list() {
    return this.repository.listTaxRules();
  }

  async get(id: string) {
    const rule = await this.repository.findTaxRuleById(id);
    if (!rule) throw new NotFoundException('Tax rule not found.');
    return rule;
  }

  async create(data: CreateTaxRuleData, actorId: string) {
    if (!isTaxCalculationBase(data.calculationBase)) throw new BadRequestException('Invalid calculationBase.');
    if (data.ratePct < 0) throw new BadRequestException('ratePct cannot be negative.');
    if (data.effectiveTo && data.effectiveTo < data.effectiveFrom) throw new BadRequestException('effectiveTo cannot be before effectiveFrom.');
    const rule = await this.repository.createTaxRule(data);
    await this.repository.recordAudit(actorId, 'FINANCE_TAX_RULE_CREATED', rule.id);
    return rule;
  }

  async update(id: string, data: UpdateTaxRuleData, actorId: string) {
    if (data.calculationBase !== undefined && !isTaxCalculationBase(data.calculationBase)) throw new BadRequestException('Invalid calculationBase.');
    if (data.ratePct !== undefined && data.ratePct < 0) throw new BadRequestException('ratePct cannot be negative.');
    const existing = await this.repository.findTaxRuleById(id);
    if (!existing) throw new NotFoundException('Tax rule not found.');
    const updated = await this.repository.updateTaxRule(id, data);
    await this.repository.recordAudit(actorId, 'FINANCE_TAX_RULE_UPDATED', id);
    return updated;
  }
}
