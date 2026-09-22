import { BadRequestException, Injectable } from '@nestjs/common';
import { LevelDef, resolveLevel, sortLevels } from './loyalty2-math';
import { Loyalty2Repository } from './loyalty2.repository';

export interface LevelInput extends LevelDef {
  isActive: boolean;
}

export interface LevelView extends LevelInput {
  cashbackPercent: number; // display convenience derived from cashbackRateBps (250 -> 2.5)
}

const CODE = /^[A-Z][A-Z0-9_]{1,15}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

// Membership levels are Admin configuration. A customer's level is never stored on the customer — it is always
// resolveLevel(levels, lifetimeSpend) — so editing a threshold immediately and consistently re-derives everyone's level.
@Injectable()
export class Loyalty2LevelsService {
  constructor(private readonly repository: Loyalty2Repository) {}

  // Active levels, ascending by threshold — what derivation uses.
  async getActiveLevels(): Promise<LevelDef[]> {
    const rows = await this.repository.findLevels();
    return sortLevels(rows.filter((r) => r.isActive));
  }

  async listForAdmin(): Promise<LevelView[]> {
    const rows = await this.repository.findLevels();
    return rows.map(toView);
  }

  resolve(levels: LevelDef[], lifetimeSpend: number) {
    return resolveLevel(levels, lifetimeSpend);
  }

  // Replace-all with full server-side validation (the Admin UI's own checks are a convenience, never the boundary).
  async replace(levels: LevelInput[]): Promise<LevelView[]> {
    if (!Array.isArray(levels) || levels.length < 1 || levels.length > 8) throw new BadRequestException('Configure between 1 and 8 levels.');
    const codes = new Set<string>();
    for (const l of levels) {
      if (typeof l.code !== 'string' || !CODE.test(l.code)) throw new BadRequestException(`Level code "${l.code}" must be 2-16 chars: A-Z, 0-9, _ and start with a letter.`);
      if (codes.has(l.code)) throw new BadRequestException(`Duplicate level code "${l.code}".`);
      codes.add(l.code);
      if (typeof l.name !== 'string' || l.name.trim().length < 1 || l.name.length > 30) throw new BadRequestException(`Level ${l.code}: name must be 1-30 characters.`);
      if (typeof l.color !== 'string' || !HEX.test(l.color)) throw new BadRequestException(`Level ${l.code}: color must be a #rrggbb hex value.`);
      if (typeof l.icon !== 'string' || l.icon.length < 1 || l.icon.length > 16) throw new BadRequestException(`Level ${l.code}: icon must be 1-16 characters.`);
      if (!Number.isInteger(l.minLifetimeSpend) || l.minLifetimeSpend < 0 || l.minLifetimeSpend > 1_000_000_000_000) throw new BadRequestException(`Level ${l.code}: minLifetimeSpend must be a non-negative integer.`);
      if (!Number.isInteger(l.cashbackRateBps) || l.cashbackRateBps < 0 || l.cashbackRateBps > 10000) throw new BadRequestException(`Level ${l.code}: cashbackRateBps must be an integer 0-10000 (basis points).`);
      if (!Number.isInteger(l.pointMultiplierPercent) || l.pointMultiplierPercent < 0 || l.pointMultiplierPercent > 1000) throw new BadRequestException(`Level ${l.code}: pointMultiplierPercent must be an integer 0-1000.`);
      if (typeof l.prioritySupport !== 'boolean' || typeof l.isActive !== 'boolean') throw new BadRequestException(`Level ${l.code}: prioritySupport and isActive must be booleans.`);
    }
    const sorted = sortLevels(levels);
    if (sorted[0].minLifetimeSpend !== 0) throw new BadRequestException('The lowest level must start at a lifetime spend of 0 so every customer has a level.');
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].minLifetimeSpend === sorted[i - 1].minLifetimeSpend) throw new BadRequestException('Two levels cannot share the same minimum lifetime spend.');
    }
    if (!sorted.some((l) => l.isActive && l.minLifetimeSpend === 0)) throw new BadRequestException('The level that starts at 0 must stay active.');
    // Only the known fields ever reach the repository (a view object with derived extras must not be persisted as-is).
    await this.repository.replaceLevels(sorted.map((x) => ({ code: x.code, name: x.name.trim(), color: x.color, icon: x.icon, minLifetimeSpend: x.minLifetimeSpend, cashbackRateBps: x.cashbackRateBps, pointMultiplierPercent: x.pointMultiplierPercent, prioritySupport: x.prioritySupport, isActive: x.isActive })));
    return this.listForAdmin();
  }
}

function toView(row: LevelInput): LevelView {
  return {
    code: row.code,
    name: row.name,
    color: row.color,
    icon: row.icon,
    minLifetimeSpend: row.minLifetimeSpend,
    cashbackRateBps: row.cashbackRateBps,
    pointMultiplierPercent: row.pointMultiplierPercent,
    prioritySupport: row.prioritySupport,
    isActive: row.isActive,
    cashbackPercent: row.cashbackRateBps / 100,
  };
}
