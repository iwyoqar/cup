import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CatalogRepository } from '../catalog/catalog.repository';
import { SegmentsService } from '../segments/segments.service';
import { AutomationSettingsService } from './automation-settings.service';
import { AnyTriggerConfig, MESSAGE_VARIABLES, parseStoredConfig, unknownVariables, validateTriggerConfig } from './automation-config';
import { AutomationStatus, isTriggerType, TRIGGER_LABELS, TRIGGER_TYPES, TriggerType } from './automation.types';
import { AutomationWithRefs, AutomationsRepository } from './automations.repository';

export interface AutomationInput {
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: unknown;
  campaignId: string;
  segmentId?: string | null;
  cooldownHours?: number;
  maxSendsPerCustomer?: number | null;
}

export interface AutomationView {
  id: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  triggerType: TriggerType;
  triggerLabel: string;
  triggerConfig: AnyTriggerConfig | null;
  campaign: { id: string; name: string; status: string };
  segment: { id: string; name: string } | null;
  cooldownHours: number;
  maxSendsPerCustomer: number | null;
  activatedAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  stats: { pending: number; sent: number; skipped: number; failed: number };
}

export interface ExecutionView {
  status: string;
  reason: string | null;
  customer: { displayName: string | null };
  trigger: string;
  campaign: string;
  createdAt: string;
  sentAt: string | null;
}

// Internal errorCodes (Telegram / transport detail) are never shown: a failed send is just DELIVERY_FAILED.
const reasonOf = (status: string, reason: string | null): string | null => reason ?? (status === 'FAILED' ? 'DELIVERY_FAILED' : null);

@Injectable()
export class AutomationsService {
  constructor(
    private readonly repository: AutomationsRepository,
    private readonly campaigns: CampaignsService,
    private readonly segments: SegmentsService,
    private readonly catalog: CatalogRepository,
    private readonly settings: AutomationSettingsService,
    private readonly config: ConfigService,
  ) {}

  async meta() {
    const s = await this.settings.getView();
    return {
      triggers: TRIGGER_TYPES.map((t) => ({ type: t, ...TRIGGER_LABELS[t] })),
      variables: [...MESSAGE_VARIABLES],
      defaults: { cooldownHours: s.defaultCooldownHours, maxSendsPerCustomer: s.defaultMaxSends },
      cartExpiryMinutes: Math.floor(this.config.env.CART_EXPIRY_MS / 60_000),
      sendGate: { crmEnabled: s.enabled, envGateOpen: s.sendGateOpen },
    };
  }

  async list(options: { cursor?: string; limit: number }) {
    const rows = await this.repository.findMany({ cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    return { items: await Promise.all(page.map((r) => this.toView(r))), nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async get(id: string): Promise<AutomationView> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Automation not found.');
    return this.toView(row);
  }

  async create(input: AutomationInput, adminId: string): Promise<AutomationView> {
    const s = await this.settings.get();
    const v = await this.validate(input, { cooldownHours: s.defaultCooldownHours, maxSendsPerCustomer: s.defaultMaxSends });
    const row = await this.repository.create({ ...v, status: 'DRAFT', createdBy: adminId });
    return this.toView(row);
  }

  async update(id: string, input: Partial<AutomationInput>, adminId: string): Promise<AutomationView> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Automation not found.');
    if (existing.status === 'ARCHIVED') throw new ConflictException('An archived automation cannot be edited.');
    const changesTrigger = input.triggerType !== undefined || input.triggerConfig !== undefined || input.campaignId !== undefined || input.segmentId !== undefined;
    // A running automation's audience/trigger must not change under its own cursor: pause first (then re-activation restarts cleanly).
    if (existing.status === 'ACTIVE' && changesTrigger) throw new ConflictException('Pause the automation before changing its trigger, campaign or segment.');
    const merged: AutomationInput = {
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      triggerType: input.triggerType ?? existing.triggerType,
      triggerConfig: input.triggerConfig ?? (parseStoredConfig(existing.triggerType as TriggerType, existing.triggerConfig) ?? {}),
      campaignId: input.campaignId ?? existing.campaignId,
      segmentId: input.segmentId !== undefined ? input.segmentId : existing.segmentId,
      cooldownHours: input.cooldownHours ?? existing.cooldownHours,
      maxSendsPerCustomer: input.maxSendsPerCustomer !== undefined ? input.maxSendsPerCustomer : existing.maxSendsPerCustomer,
    };
    const v = await this.validate(merged, { cooldownHours: 24, maxSendsPerCustomer: null });
    const row = await this.repository.update(id, { ...v, updatedBy: adminId, ...(changesTrigger ? { eventCursor: null, lastRunKey: null } : {}) });
    return this.toView(row);
  }

  async activate(id: string, adminId: string): Promise<AutomationView> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Automation not found.');
    if (row.status === 'ACTIVE') return this.toView(row);
    if (row.status === 'ARCHIVED') throw new ConflictException('An archived automation cannot be activated.');
    // Re-validate everything at activation (the campaign or config may have changed since the draft was saved).
    await this.validate(
      {
        name: row.name,
        description: row.description,
        triggerType: row.triggerType,
        triggerConfig: parseStoredConfig(row.triggerType as TriggerType, row.triggerConfig) ?? {},
        campaignId: row.campaignId,
        segmentId: row.segmentId,
        cooldownHours: row.cooldownHours,
        maxSendsPerCustomer: row.maxSendsPerCustomer,
      },
      { cooldownHours: 24, maxSendsPerCustomer: null },
      true,
    );
    // Activation stamps the watermark and restarts consumption: nothing that happened before this instant can fire.
    return this.toView(await this.repository.update(id, { status: 'ACTIVE', activatedAt: new Date(), eventCursor: null, lastRunKey: null, updatedBy: adminId }));
  }

  async pause(id: string, adminId: string): Promise<AutomationView> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Automation not found.');
    if (row.status !== 'ACTIVE') throw new ConflictException('Only an active automation can be paused.');
    return this.toView(await this.repository.update(id, { status: 'PAUSED', updatedBy: adminId }));
  }

  // Archive instead of delete: an automation's execution history is kept forever.
  async archive(id: string, adminId: string): Promise<AutomationView> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Automation not found.');
    return this.toView(await this.repository.update(id, { status: 'ARCHIVED', updatedBy: adminId }));
  }

  async executions(id: string, options: { cursor?: string; limit: number }) {
    if (!(await this.repository.findById(id))) throw new NotFoundException('Automation not found.');
    const rows = await this.repository.listExecutions(id, { cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: page.map((r): ExecutionView => ({
        status: r.status,
        reason: reasonOf(r.status, r.reason),
        customer: { displayName: r.customer.displayName },
        trigger: r.automation.triggerType,
        campaign: r.automation.campaign.name,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Customer 360 — recent CRM automation activity for one customer (bounded, display-only, no ids / technical errors).
  async recentForCustomer(customerId: string, take = 10) {
    const rows = await this.repository.recentForCustomer(customerId, take);
    return rows.map((r) => ({ automationName: r.automation.name, triggerType: r.automation.triggerType, status: r.status, reason: reasonOf(r.status, r.reason), at: (r.sentAt ?? r.createdAt).toISOString() }));
  }

  // ---------------------------------------------------------------------------------------------------------- validation

  private async validate(input: AutomationInput, defaults: { cooldownHours: number; maxSendsPerCustomer: number | null }, forActivation = false) {
    if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 100) throw new BadRequestException('name must be 1-100 characters.');
    if (input.description != null && (typeof input.description !== 'string' || input.description.length > 500)) throw new BadRequestException('description must be at most 500 characters.');
    if (typeof input.triggerType !== 'string' || !isTriggerType(input.triggerType)) throw new BadRequestException('Unknown triggerType.');
    const type = input.triggerType;
    const config = validateTriggerConfig(type, input.triggerConfig);

    const cooldownHours = input.cooldownHours ?? defaults.cooldownHours;
    if (!Number.isInteger(cooldownHours) || cooldownHours < 0 || cooldownHours > 24 * 365) throw new BadRequestException('cooldownHours must be an integer between 0 and 8760.');
    const maxSends = input.maxSendsPerCustomer === undefined ? defaults.maxSendsPerCustomer : input.maxSendsPerCustomer;
    if (maxSends !== null && (!Number.isInteger(maxSends) || maxSends < 1 || maxSends > 1000)) throw new BadRequestException('maxSendsPerCustomer must be null (unlimited) or an integer between 1 and 1000.');

    const campaign = await this.campaigns.getById(input.campaignId);
    if (!campaign) throw new BadRequestException('Campaign not found.');
    if (campaign.channel !== 'telegram') throw new BadRequestException('Only Telegram campaigns can be automated.');
    if (campaign.messageText.trim().length === 0) throw new BadRequestException('The campaign message is empty.');
    const bad = unknownVariables(campaign.messageText);
    if (bad.length > 0) throw new BadRequestException(`The campaign message uses unknown variables: ${bad.map((b) => `{{${b}}}`).join(', ')}. Allowed: ${MESSAGE_VARIABLES.map((v) => `{{${v}}}`).join(', ')}.`);
    if (forActivation && campaign.status !== 'draft' && campaign.status !== 'completed') throw new ConflictException('The campaign is not ready (it is being sent or has failed).');

    let segmentId: string | null = input.segmentId ?? null;
    if (segmentId && !(await this.segments.getById(segmentId))) throw new BadRequestException('Segment not found.');
    if (type === 'SCHEDULED_SEGMENT' && !segmentId) throw new BadRequestException('A scheduled-segment automation needs a segment (its audience).');
    if (type !== 'SCHEDULED_SEGMENT' && segmentId === '') segmentId = null;

    if (type === 'REWARD_UNLOCKED' && !(await this.repository.findRewardProgram((config as { rewardProgramId: string }).rewardProgramId))) throw new BadRequestException('Reward program not found.');
    if (type === 'LOYALTY_MILESTONE') {
      const categoryId = (config as { categoryId?: string }).categoryId;
      if (categoryId) {
        const category = await this.catalog.findCategoryById(categoryId);
        if (!category || !category.isActive) throw new BadRequestException('categoryId does not exist or is not active.');
      }
    }
    if (type === 'ABANDONED_CART') {
      const delayMs = (config as { delayMinutes: number }).delayMinutes * 60_000;
      if (delayMs >= this.config.env.CART_EXPIRY_MS) throw new BadRequestException(`delayMinutes must be shorter than the cart expiry (${Math.floor(this.config.env.CART_EXPIRY_MS / 60_000)} minutes) — an expired cart is never messaged.`);
    }

    return {
      name: input.name.trim(),
      description: input.description ?? null,
      triggerType: type,
      triggerConfig: JSON.stringify(config),
      campaignId: input.campaignId,
      segmentId,
      cooldownHours,
      maxSendsPerCustomer: maxSends,
    };
  }

  private async toView(row: AutomationWithRefs): Promise<AutomationView> {
    const stats = await this.repository.executionStats(row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status as AutomationStatus,
      triggerType: row.triggerType as TriggerType,
      triggerLabel: TRIGGER_LABELS[row.triggerType as TriggerType]?.label ?? row.triggerType,
      triggerConfig: parseStoredConfig(row.triggerType as TriggerType, row.triggerConfig),
      campaign: { id: row.campaign.id, name: row.campaign.name, status: row.campaign.status },
      segment: row.segment ? { id: row.segment.id, name: row.segment.name } : null,
      cooldownHours: row.cooldownHours,
      maxSendsPerCustomer: row.maxSendsPerCustomer,
      activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      stats: { pending: stats.PENDING ?? 0, sent: stats.SENT ?? 0, skipped: stats.SKIPPED ?? 0, failed: stats.FAILED ?? 0 },
    };
  }
}
