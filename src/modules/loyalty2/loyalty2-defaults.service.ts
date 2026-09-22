import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_ACHIEVEMENTS, DEFAULT_LEVELS } from './loyalty2-defaults';
import { Loyalty2Repository } from './loyalty2.repository';

// Seeds the STARTING configuration once into an empty database (same precedent as LoyaltyCodeService's bootstrap backfill).
// Idempotent: it only writes when the table is empty, so an admin's edits (or deletions down to zero rows... which the levels
// validation forbids) are never overwritten. The program itself stays OFF until an admin enables it, and every seeded
// achievement reward is 0 points.
@Injectable()
export class Loyalty2DefaultsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(Loyalty2DefaultsService.name);

  constructor(private readonly repository: Loyalty2Repository) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      if ((await this.repository.countLevels()) === 0) {
        await this.repository.createLevels(DEFAULT_LEVELS);
        this.logger.log('Seeded default Loyalty 2.0 levels (editable in Admin).');
      }
      if ((await this.repository.countAchievements()) === 0) {
        await this.repository.createAchievements(DEFAULT_ACHIEVEMENTS.map((a) => ({ ...a, rewardPoints: 0 })));
        this.logger.log('Seeded default Loyalty 2.0 achievements (editable in Admin).');
      }
    } catch (err) {
      // A failed seed must never stop the app from booting; the Admin page simply shows an empty configuration.
      this.logger.error(`Loyalty 2.0 default seed failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
