import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Post, Query, Req, Res, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ConfigService } from '../../common/config/config.service';
import { PosWidgetAuditService } from './pos-widget-audit.service';
import { PosWidgetAuthService } from './pos-widget-auth.service';
import { OverviewIdentifier, PosWidgetOverviewService } from './pos-widget-overview.service';
import { RedeemPromotionInputError, PosWidgetPromotionRedemptionService } from './pos-widget-promotion-redemption.service';
import { RedeemRewardInputError, PosWidgetRewardRedemptionService } from './pos-widget-reward-redemption.service';
import { PosContext } from './pos-widget-signature';

type PosRequest = FastifyRequest & { posContext?: PosContext };

// Rejection reasons map to HTTP: feature off / not configured -> 503, missing / stale / bad signature -> 401, wrong Poster account -> 403.
@Injectable()
export class PosWidgetGuard implements CanActivate {
  constructor(private readonly auth: PosWidgetAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<PosRequest>();
    const result = this.auth.authenticate(req);
    if (result.ok) {
      req.posContext = result.context;
      return true;
    }
    if (result.reason === 'DISABLED' || result.reason === 'NOT_CONFIGURED') throw new ServiceUnavailableException({ status: 'unavailable', enabled: this.auth.enabled });
    if (result.reason === 'WRONG_ACCOUNT') throw new ForbiddenException({ status: 'rejected', reason: 'WRONG_ACCOUNT' });
    throw new UnauthorizedException({ status: 'rejected', reason: result.reason });
  }
}

// Phase 22 — the SAME verified-signature guard, plus an independent operator interlock (POS_REWARD_REDEMPTION_ENABLED). Both must hold for
// POST /pos-widget/rewards/redeem to run at all: this is checked BEFORE the request body is even parsed for business logic, so when the flag is off the
// endpoint behaves exactly like POS_WIDGET_ENABLED off — 503, nothing read, nothing written. The flag does not, by itself, make a real mutation happen
// (see poster-reward-mutation.service.ts) — it exists purely so it can be wired ahead of that verification.
@Injectable()
export class PosRewardRedemptionGuard implements CanActivate {
  constructor(
    private readonly auth: PosWidgetAuthService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.env.POS_REWARD_REDEMPTION_ENABLED) throw new ServiceUnavailableException({ status: 'unavailable', enabled: false, feature: 'reward-redemption' });
    const req = context.switchToHttp().getRequest<PosRequest>();
    const result = this.auth.authenticate(req);
    if (result.ok) {
      req.posContext = result.context;
      return true;
    }
    if (result.reason === 'DISABLED' || result.reason === 'NOT_CONFIGURED') throw new ServiceUnavailableException({ status: 'unavailable', enabled: this.auth.enabled });
    if (result.reason === 'WRONG_ACCOUNT') throw new ForbiddenException({ status: 'rejected', reason: 'WRONG_ACCOUNT' });
    throw new UnauthorizedException({ status: 'rejected', reason: result.reason });
  }
}

// Phase 23 — the SAME verified-signature guard, plus its own independent operator interlock (POS_PROMOTION_REDEMPTION_ENABLED). Mirrors
// PosRewardRedemptionGuard exactly; a separate class (not a shared parameterized one) so each feature's flag check is a single, greppable line, matching
// how the two flags are deliberately independent in env.schema.ts.
@Injectable()
export class PosPromotionRedemptionGuard implements CanActivate {
  constructor(
    private readonly auth: PosWidgetAuthService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.env.POS_PROMOTION_REDEMPTION_ENABLED) throw new ServiceUnavailableException({ status: 'unavailable', enabled: false, feature: 'promotion-redemption' });
    const req = context.switchToHttp().getRequest<PosRequest>();
    const result = this.auth.authenticate(req);
    if (result.ok) {
      req.posContext = result.context;
      return true;
    }
    if (result.reason === 'DISABLED' || result.reason === 'NOT_CONFIGURED') throw new ServiceUnavailableException({ status: 'unavailable', enabled: this.auth.enabled });
    if (result.reason === 'WRONG_ACCOUNT') throw new ForbiddenException({ status: 'rejected', reason: 'WRONG_ACCOUNT' });
    throw new UnauthorizedException({ status: 'rejected', reason: result.reason });
  }
}

// Exactly the shape pos-widget-reward-redemption.types.ts's RedeemRewardRequest expects. .strict(): an unknown field is a 400, same discipline as the
// overview's query schema.
const redeemBodySchema = z
  .object({
    attemptId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    posterClientId: z.string().regex(/^\d{1,12}$/),
    posterOrderId: z.string().regex(/^\d{1,20}$/),
    rewardProgramId: z.string().min(1).max(64),
    posterProductId: z.string().regex(/^\d{1,12}$/),
    // The widget's `state.employee` (pos-widget/src/store.ts) is typed `string | null` and starts `null` until/unless users.getActiveUser() resolves — a
    // real bug found live (2026-09-22, immediately after go-live): this schema only accepted `string | undefined`, so every request sent while no
    // employee was known (i.e. every request, since the widget always sends the key) failed here with a generic 400, before ever resolving the customer.
    employeeIdentifier: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

// Exactly the shape pos-widget-promotion-redemption.types.ts's RedeemPromotionRequest expects. No posterProductId: the promotion's benefit product (if
// any) is fixed on the Promotion record itself, never chosen by the widget — unlike rewards, where the customer may qualify with several products.
const redeemPromotionBodySchema = z
  .object({
    attemptId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    posterClientId: z.string().regex(/^\d{1,12}$/),
    posterOrderId: z.string().regex(/^\d{1,20}$/),
    promotionId: z.string().min(1).max(64),
    employeeIdentifier: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

// Exactly ONE identifier, each strictly shaped. .strict(): an unknown parameter (in particular orderTotal — reserved for Phase 22) is a 400. `ref` is an opaque
// echo the widget uses to tie a response to the request it made (stale-response protection); it is returned verbatim and never interpreted.
const querySchema = z
  .object({
    posterClientId: z.string().regex(/^\d{1,12}$/).optional(),
    code: z.string().trim().min(3).max(64).optional(),
    phone: z.string().trim().min(6).max(32).regex(/^[+\d\s()-]+$/).optional(),
    ref: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/).optional(),
  })
  .strict()
  .refine((q) => [q.posterClientId, q.code, q.phone].filter((v) => v !== undefined).length === 1, 'Exactly one identifier is required.');

// Phase 21 — the POS widget backend. READ-ONLY by construction: no mutation method of any service is injected, no Poster call and no Telegram call is made, and
// nothing is written except the (de-duplicated) audit row. Poster must keep working when CUP is down; nothing here is a dependency of the POS.
@Controller('pos-widget')
export class PosWidgetController {
  constructor(
    private readonly auth: PosWidgetAuthService,
    private readonly overview: PosWidgetOverviewService,
    private readonly audit: PosWidgetAuditService,
    private readonly rewardRedemption: PosWidgetRewardRedemptionService,
    private readonly promotionRedemption: PosWidgetPromotionRedemptionService,
    private readonly config: ConfigService,
  ) {}

  // A connectivity / authentication probe. Exposes no customer data. It answers whether the widget is enabled, whether THIS request authenticated, whether Poster
  // sent a signature at all (the open question about ordinary makeRequest calls), and — only when authenticated — the verified account / spot / register.
  @Get('ping')
  ping(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const result = this.auth.authenticate(req);
    if (result.ok) {
      return { status: 'ok', enabled: true, authenticated: true, signaturePresent: true, account: result.context.account, spotId: result.context.spotId, tabletId: result.context.tabletId, serverTime: new Date().toISOString() };
    }
    const disabled = result.reason === 'DISABLED' || result.reason === 'NOT_CONFIGURED';
    reply.status(disabled ? 503 : result.reason === 'WRONG_ACCOUNT' ? 403 : 401);
    return { status: disabled ? 'unavailable' : 'rejected', enabled: this.auth.enabled, authenticated: false, signaturePresent: result.signaturePresent, reason: result.reason, serverTime: new Date().toISOString() };
  }

  @Get('overview')
  @UseGuards(PosWidgetGuard)
  async overviewFor(@Query() query: Record<string, string | undefined>, @Req() req: PosRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store'); // reward availability is operationally important: never served stale
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid overview query.');
    const q = parsed.data;
    const identifier: OverviewIdentifier = q.posterClientId ? { kind: 'posterClientId', value: q.posterClientId } : q.code ? { kind: 'code', value: q.code } : { kind: 'phone', value: q.phone as string };
    const ctx = req.posContext as PosContext;

    const resolved = await this.overview.resolve(identifier);
    const base = { ref: q.ref ?? null, generatedAt: new Date().toISOString() };
    if (resolved.kind !== 'FOUND') {
      // A typed code / phone that matches nobody is worth an audit line (no identifier is stored); a Poster client id with no mapping is system-driven and is not.
      if (resolved.kind === 'NOT_FOUND' && identifier.kind !== 'posterClientId') await this.audit.record(ctx, null, 'NOT_FOUND');
      return { ...base, state: resolved.kind, customer: null, linkedToPoster: false, loyalty: null, rewards: null, promotions: { redemption: { enabled: this.config.env.POS_PROMOTION_REDEMPTION_ENABLED }, items: [] }, activity: null };
    }
    const body = await this.overview.build(resolved.customer);
    await this.audit.record(ctx, resolved.customer.id, 'FOUND');
    return { ...base, state: 'FOUND' as const, ...body };
  }

  // Phase 22 — the ONE write route this controller has. Reuses PosWidgetGuard's exact signature verification via PosRewardRedemptionGuard (see above),
  // PLUS the independent POS_REWARD_REDEMPTION_ENABLED interlock. Every business decision (customer identity, reward eligibility, product validity,
  // idempotency, concurrency, whether Poster can even be mutated at all) happens server-side in PosWidgetRewardRedemptionService — nothing here trusts the
  // request body beyond its shape. See docs/PHASE-22-AUDIT.md: no Poster mutation mechanism is currently verified safe, so this endpoint's real answer is
  // always a structured FAILED result today — it never silently succeeds, and it never writes a RewardRedemption row.
  @Post('rewards/redeem')
  @UseGuards(PosRewardRedemptionGuard)
  async redeemReward(@Body() rawBody: unknown, @Req() req: PosRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const parsed = redeemBodySchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Invalid redemption request.');
    const ctx = req.posContext as PosContext;
    try {
      return await this.rewardRedemption.redeem(ctx, { ...parsed.data, employeeIdentifier: parsed.data.employeeIdentifier ?? null });
    } catch (err) {
      if (err instanceof RedeemRewardInputError) throw new BadRequestException({ status: 'rejected', reason: err.reason });
      throw err;
    }
  }

  // Phase 23 — the promotion equivalent of redeemReward, same guard/schema/error-handling discipline. See docs/PHASE-23-PROMOTIONS.md: FREE_PRODUCT and
  // LOYALTY_POINTS have a verified-safe mutation path; PERCENT_DISCOUNT/FIXED_DISCOUNT do not and always resolve FAILED regardless of this flag.
  @Post('promotions/redeem')
  @UseGuards(PosPromotionRedemptionGuard)
  async redeemPromotion(@Body() rawBody: unknown, @Req() req: PosRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const parsed = redeemPromotionBodySchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Invalid redemption request.');
    const ctx = req.posContext as PosContext;
    try {
      return await this.promotionRedemption.redeem(ctx, { ...parsed.data, employeeIdentifier: parsed.data.employeeIdentifier ?? null });
    } catch (err) {
      if (err instanceof RedeemPromotionInputError) throw new BadRequestException({ status: 'rejected', reason: err.reason });
      throw err;
    }
  }
}

