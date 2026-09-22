import { createHash } from 'node:crypto';
import { ExecutionContext, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '../../src/common/config/config.service';
import { PosPromotionRedemptionGuard } from '../../src/modules/pos-widget/pos-widget.controller';
import { PosWidgetAuthService } from '../../src/modules/pos-widget/pos-widget-auth.service';

// Phase 23 — the guard is new code (a Phase 23 artifact), even though it delegates its actual signature check to the SAME PosWidgetAuthService Phase
// 21/22 already established and reuse unchanged. Verifies: the flag is checked BEFORE the signature (fails closed fastest), and every one of
// PosWidgetAuthService's rejection reasons maps to the same HTTP-exception shape PosRewardRedemptionGuard already uses.
const SECRET = 'test-poster-secret';
const ACCOUNT = 'testacct';
const PUBLIC_URL = 'https://cup.example.test';

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

function fakeContext(req: Partial<{ headers: Record<string, string>; method: string; body: unknown; url: string }>): ExecutionContext {
  const request = { headers: {}, method: 'POST', body: {}, url: '/pos-widget/promotions/redeem', ...req };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function signedHeaders(body: unknown, opts: { time?: string; secret?: string; account?: string; url?: string } = {}): Record<string, string> {
  const time = opts.time ?? String(Math.floor(Date.now() / 1000));
  const url = opts.url ?? PUBLIC_URL + '/pos-widget/promotions/redeem';
  const signStr = url + (body && Object.keys(body as object).length > 0 ? JSON.stringify(body) : '') + time + (opts.secret ?? SECRET);
  return { 'x-poster-time': time, 'x-poster-signature': md5(signStr), 'x-poster-url': opts.account ?? ACCOUNT, 'x-poster-spot-id': '1', 'x-poster-tablet-id': '1' };
}

describe('PosPromotionRedemptionGuard', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.POS_WIDGET_ENABLED = 'true';
    process.env.POS_WIDGET_ACCOUNT = ACCOUNT;
    process.env.POS_WIDGET_PUBLIC_URL = PUBLIC_URL;
    process.env.POSTER_APPLICATION_SECRET = SECRET;
    process.env.POS_PROMOTION_REDEMPTION_ENABLED = 'true';
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  function buildGuard(): PosPromotionRedemptionGuard {
    const config = new ConfigService();
    const auth = new PosWidgetAuthService(config);
    return new PosPromotionRedemptionGuard(auth, config);
  }

  it('flag OFF -> 503, checked BEFORE the signature (a validly-signed request still gets 503)', () => {
    process.env.POS_PROMOTION_REDEMPTION_ENABLED = 'false';
    const guard = buildGuard();
    const body = { attemptId: 'x' };
    const ctx = fakeContext({ body, headers: signedHeaders(body) });
    expect(() => guard.canActivate(ctx)).toThrow(ServiceUnavailableException);
  });

  it('missing signature -> 401', () => {
    const guard = buildGuard();
    const ctx = fakeContext({ body: {}, headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('a valid signature for a DIFFERENT body is rejected -> 401 (proves the body genuinely participates in the check)', () => {
    const guard = buildGuard();
    const realBody = { attemptId: 'real-attempt', promotionId: 'promo-1' };
    const headersForOtherBody = signedHeaders({ attemptId: 'other', promotionId: 'other' });
    const ctx = fakeContext({ body: realBody, headers: headersForOtherBody });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('wrong account -> 403', () => {
    const guard = buildGuard();
    const body = { attemptId: 'x' };
    const ctx = fakeContext({ body, headers: signedHeaders(body, { account: 'someone-else' }) });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('a correctly signed request passes and populates posContext', () => {
    const guard = buildGuard();
    const body = { attemptId: 'x', promotionId: 'promo-1' };
    const request: { headers: Record<string, string>; body: unknown; method: string; url: string; posContext?: unknown } = {
      headers: signedHeaders(body),
      body,
      method: 'POST',
      url: '/pos-widget/promotions/redeem',
    };
    const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.posContext).toEqual({ account: ACCOUNT, spotId: '1', tabletId: '1' });
  });
});
