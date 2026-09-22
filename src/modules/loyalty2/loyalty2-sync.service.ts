import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltySettingsService } from '../loyalty/loyalty-settings.service';
import { isAchievementConditionType } from './loyalty2-defaults';
import { Loyalty2LevelsService } from './loyalty2-levels.service';
import { cashbackFor, pointsFor, resolveLevel } from './loyalty2-math';
import { Loyalty2ProgressService } from './loyalty2-progress.service';
import { Loyalty2SettingsService } from './loyalty2-settings.service';
import { Loyalty2Repository } from './loyalty2.repository';

export interface SyncResult {
  skipped: boolean; // program switched off
  accrued: number; // purchases processed (cashback / points written)
  levelUps: number;
  unlocked: number;
}

const MAX_ACCRUALS_PER_SYNC = 500;

// The ONLY writer of Loyalty 2.0 state. Everything it writes is exactly-once by construction (a unique constraint per
// purchase / level / achievement / birthday year), so it is safe to run repeatedly, concurrently, lazily from the Mini App
// and from the background job:
//   - Accrual: one LoyaltyAccrual row per qualifying purchase (unique sourceType+sourceId) is created in the SAME transaction
//     as that purchase's cashback ledger row and its loyalty points credit — all commit or none do. The rules used
//     (level, rates) are snapshotted on the row, so later configuration changes never rewrite past earnings.
//   - Level-up: a LEVEL_UP event per level ever reached, timestamped at the purchase that crossed the threshold.
//   - Achievement: unlocked once, its reward points credited in the same transaction.
// Nothing here touches Poster, Telegram, orders or the reward engine.
@Injectable()
export class Loyalty2SyncService {
  private readonly logger = new Logger(Loyalty2SyncService.name);

  constructor(
    private readonly repository: Loyalty2Repository,
    private readonly settingsService: Loyalty2SettingsService,
    private readonly loyaltySettings: LoyaltySettingsService,
    private readonly levelsService: Loyalty2LevelsService,
    private readonly progress: Loyalty2ProgressService,
    private readonly loyalty: LoyaltyService,
    private readonly prisma: PrismaService,
  ) {}

  async syncCustomer(customerId: string, now: Date = new Date()): Promise<SyncResult> {
    const settings = await this.settingsService.get();
    const result: SyncResult = { skipped: false, accrued: 0, levelUps: 0, unlocked: 0 };
    if (!settings.enabled) return { ...result, skipped: true };

    const [levels, purchases] = await Promise.all([this.levelsService.getActiveLevels(), this.repository.qualifyingPurchases(customerId)]);
    // Running lifetime spend BEFORE each purchase, in the total (time, source, id) order.
    const spendBefore: number[] = [];
    let running = 0;
    for (const p of purchases) {
      spendBefore.push(running);
      running += p.amountMinor;
    }
    const totalSpend = running;

    // 1. Accruals — cashback and points for purchases on/after accrualStartsAt that were not processed yet.
    if (settings.accrualStartsAt) {
      const startMs = Date.parse(settings.accrualStartsAt);
      const [processed, earn] = await Promise.all([this.repository.processedAccruals(customerId), this.loyaltySettings.get()]);
      let handled = 0;
      for (let i = 0; i < purchases.length && handled < MAX_ACCRUALS_PER_SYNC; i += 1) {
        const p = purchases[i];
        if (p.at.getTime() < startMs || processed.has(`${p.sourceType}:${p.sourceId}`)) continue;
        handled += 1;
        // The level in force BEFORE this purchase (a purchase that crosses a threshold earns at the old level's rate).
        const level = resolveLevel(levels, spendBefore[i]).current;
        const cashbackMinor = settings.cashbackEnabled && level ? cashbackFor(p.amountMinor, level.cashbackRateBps) : 0;
        const pointsAwarded = settings.purchasePointsEnabled && earn.enabled ? pointsFor(p.amountMinor, earn.earnRate, earn.earnUnitAmount, earn.minimumOrderAmount, level ? level.pointMultiplierPercent : 100) : 0;
        try {
          await this.prisma.runTransaction(async (tx) => {
            await this.repository.createAccrual(tx, {
              customerId,
              sourceType: p.sourceType,
              sourceId: p.sourceId,
              occurredAt: p.at,
              amountMinor: p.amountMinor,
              levelCode: level ? level.code : null,
              pointsAwarded,
              cashbackMinor,
              cashbackRateBps: level && cashbackMinor > 0 ? level.cashbackRateBps : 0,
            });
            if (cashbackMinor > 0) {
              const totals = await this.repository.cashbackTotals(tx, customerId);
              await this.repository.createCashback(tx, {
                customerId,
                type: 'EARN',
                amountMinor: cashbackMinor,
                balanceAfter: totals.balance + cashbackMinor,
                sourceType: p.sourceType,
                sourceId: p.sourceId,
                levelCode: level ? level.code : null,
                rateBps: level ? level.cashbackRateBps : null,
                description: 'Cashback',
              });
            }
            if (pointsAwarded > 0) {
              await this.loyalty.creditPointsTx(tx, customerId, pointsAwarded, { description: 'Purchase', orderId: p.sourceType === 'CUP_ORDER' ? p.sourceId : null });
            }
          });
          result.accrued += 1;
        } catch (err) {
          if (!isUniqueConstraintViolation(err)) throw err; // a concurrent sync processed it first — fine
        }
      }
    }

    // 2. Level-ups — one event per level ever reached (the base level is not a "level up"), dated at the crossing purchase.
    const recorded = await this.repository.recordedLevelCodes(customerId);
    for (const level of levels) {
      if (level.minLifetimeSpend <= 0 || level.minLifetimeSpend > totalSpend || recorded.has(level.code)) continue;
      const idx = purchases.findIndex((p, i) => spendBefore[i] + p.amountMinor >= level.minLifetimeSpend);
      if (idx < 0) continue;
      try {
        await this.repository.createLevelUp(this.prisma, { customerId, levelCode: level.code, levelName: level.name, reachedAt: purchases[idx].at });
        result.levelUps += 1;
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
      }
    }

    // 3. Achievements — unlock (once) every active achievement whose condition is now met.
    const [defs, unlocks] = await Promise.all([this.repository.findAchievements({ activeOnly: true }), this.repository.unlocks(customerId)]);
    const unlockedIds = new Set(unlocks.map((u) => u.achievementId));
    const candidates = defs.filter((a) => !unlockedIds.has(a.id) && isAchievementConditionType(a.conditionType));
    const evaluated = await this.progress.evaluate(customerId, candidates, settings.streakEnabled, now);
    for (const a of candidates) {
      if (!evaluated.get(a.id)?.met) continue;
      try {
        await this.prisma.runTransaction(async (tx) => {
          await this.repository.createUnlock(tx, { customerId, achievementId: a.id, pointsAwarded: a.rewardPoints });
          if (a.rewardPoints > 0) await this.loyalty.creditPointsTx(tx, customerId, a.rewardPoints, { description: `Achievement: ${a.name}` });
        });
        result.unlocked += 1;
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
      }
    }
    return result;
  }

  // Background entry point: the next batch of customers that have qualifying purchases with no accrual yet.
  async syncPending(batchSize: number): Promise<number> {
    const settings = await this.settingsService.get();
    if (!settings.enabled || !settings.accrualStartsAt) return 0;
    const ids = await this.repository.customersWithUnprocessedPurchases(Date.parse(settings.accrualStartsAt), batchSize);
    for (const id of ids) {
      try {
        await this.syncCustomer(id);
      } catch (err) {
        this.logger.error(`Loyalty 2.0 sync failed for one customer: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return ids.length;
  }
}
