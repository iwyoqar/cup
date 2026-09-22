import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { birthdayStatus } from './loyalty2-math';
import { Loyalty2ProgressService } from './loyalty2-progress.service';
import { Loyalty2SettingsService } from './loyalty2-settings.service';
import { Loyalty2Repository } from './loyalty2.repository';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class Loyalty2BirthdayService {
  constructor(
    private readonly repository: Loyalty2Repository,
    private readonly settingsService: Loyalty2SettingsService,
    private readonly progress: Loyalty2ProgressService,
    private readonly loyalty: LoyaltyService,
    private readonly prisma: PrismaService,
  ) {}

  // The customer sets their OWN birthday, once. It cannot be changed afterwards (which would let someone re-arm the
  // once-a-year reward); a correction is an admin/support matter for a later phase.
  async setOwnBirthday(customerId: string, isoDate: string, now: Date = new Date()): Promise<void> {
    if (typeof isoDate !== 'string' || !DATE_ONLY.test(isoDate)) throw new BadRequestException('birthDate must be YYYY-MM-DD.');
    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) throw new BadRequestException('birthDate is not a valid date.');
    const year = +isoDate.slice(0, 4);
    if (year < 1900 || date.getTime() > now.getTime()) throw new BadRequestException('birthDate is out of range.');
    const stored = await this.repository.setBirthDateIfMissing(customerId, date);
    if (!stored) throw new ConflictException('Birthday is already set.');
  }

  // FOUNDATION for a later phase — deliberately not reachable from any HTTP route. Records the once-per-year claim (unique
  // customerId+year) and credits the configured points in one transaction. Returns false when not eligible or already claimed.
  async claimBirthdayReward(customerId: string, now: Date = new Date()): Promise<boolean> {
    const settings = await this.settingsService.get();
    if (!settings.enabled) return false;
    const [birthDate, claimed] = await Promise.all([this.repository.findBirthDate(customerId), this.repository.claimedBirthdayYears(customerId)]);
    const status = birthdayStatus(birthDate, this.progress.today(now), settings.birthdayWindowDays, claimed, settings.birthdayEnabled);
    if (!status.eligible || status.rewardYear === null) return false;
    try {
      await this.prisma.runTransaction(async (tx) => {
        await this.repository.createBirthdayClaim(tx, { customerId, year: status.rewardYear as number, points: settings.birthdayRewardPoints });
        if (settings.birthdayRewardPoints > 0) await this.loyalty.creditPointsTx(tx, customerId, settings.birthdayRewardPoints, { description: 'Birthday reward' });
      });
      return true;
    } catch (err) {
      if (isUniqueConstraintViolation(err)) return false;
      throw err;
    }
  }
}
