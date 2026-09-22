import { Injectable } from '@nestjs/common';
import { CustomerMetricsService } from '../customer-metrics/customer-metrics.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { Loyalty2ProfileService } from '../loyalty2/loyalty2-profile.service';
import { RewardProgramsService } from '../rewards/reward-programs.service';
import { findVariables, MessageVariable, renderVariables } from './automation-config';
import { AutomationsRepository } from './automations.repository';

// Personalisation (Phase 13): the Campaign's messageText stays authoritative; this only substitutes an ALLOWLISTED set of variables ({{firstName}},
// {{displayName}}, {{points}}, {{rewardCount}}, {{rewardProgress}}, {{level}}, {{branchName}}) with values computed SERVER-SIDE from existing
// services. It is not a template language: no expressions, no code, no customer-supplied template content. An unknown variable is left visibly
// unresolved. Only the variables actually present in the text are computed.
@Injectable()
export class AutomationMessageService {
  constructor(
    private readonly repository: AutomationsRepository,
    private readonly loyalty: LoyaltyService,
    private readonly rewards: RewardProgramsService,
    private readonly loyalty2: Loyalty2ProfileService,
    private readonly metrics: CustomerMetricsService,
  ) {}

  async render(template: string, customerId: string): Promise<string> {
    const wanted = new Set(findVariables(template));
    if (wanted.size === 0) return template;
    const values: Partial<Record<MessageVariable, string>> = {};

    if (wanted.has('firstName') || wanted.has('displayName')) {
      const names = (await this.repository.customerNames([customerId])).get(customerId);
      const display = names?.displayName ?? '';
      values.displayName = display;
      values.firstName = names?.firstName ?? display.split(/\s+/)[0] ?? '';
    }
    if (wanted.has('points')) {
      values.points = String((await this.loyalty.getAccountSnapshot(customerId))?.balance ?? 0);
    }
    if (wanted.has('rewardCount') || wanted.has('rewardProgress')) {
      const programs = await this.rewards.listForCustomer(customerId);
      values.rewardCount = String(programs.reduce((sum, p) => sum + p.availableRewards, 0));
      values.rewardProgress = programs.length > 0 ? `${programs[0].qualifyingCount}/${programs[0].threshold}` : '';
    }
    if (wanted.has('level')) {
      const profile = await this.loyalty2.getProfile(customerId);
      values.level = profile.enabled && profile.level ? profile.level.name : '';
    }
    if (wanted.has('branchName')) {
      values.branchName = (await this.metrics.getBulkMetrics([customerId])).get(customerId)?.favoriteBranch ?? '';
    }
    return renderVariables(template, values);
  }
}
