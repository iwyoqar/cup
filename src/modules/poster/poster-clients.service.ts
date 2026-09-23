import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PosterService } from './poster.service';

// What staff are shown for a possible Poster match. Deliberately minimal: a display name and the last
// four digits of the phone — never the raw Poster client id, full phone, card number or any money
// field. `choice` is an opaque, customer-bound token the server re-derives on link (see
// StaffCustomersService), so the browser never needs the real Poster id.
export interface PosterClientCandidate {
  clientId: string; // internal to the backend — StaffCustomersService strips it before responding
  displayName: string;
  phoneLast4: string;
}

// Phase 25 — the result of an automatic find-or-create attempt (Telegram registration only; the
// Staff Panel's own manual flow above is unaffected and still never auto-selects). AMBIGUOUS and
// FAILED are deliberately NOT distinguished further to callers — either way nothing is linked and
// the customer falls back to Staff Panel manual linking; the `reason` on FAILED is for logs only.
export type PosterClientLinkOutcome = { kind: 'FOUND'; clientId: string } | { kind: 'AMBIGUOUS' } | { kind: 'FAILED'; reason: string };

// Phase 11 — Poster customer matching, READ-ONLY (findCandidatesByPhone). All Poster HTTP still goes
// through PosterService; this is the domain adapter on top of it.
// Phase 25 — findOrCreateByPhone is the one place this adapter now DOES create a Poster client, for
// the automatic Telegram-registration link only. It still never chooses between multiple existing
// candidates (that stays the Staff Panel's explicit-choice job) — it only ever creates when there
// are exactly zero.
@Injectable()
export class PosterClientsService {
  private readonly logger = new Logger(PosterClientsService.name);

  // Phase 25 — in-process only: guards against two concurrent registrations for the SAME normalized
  // phone both seeing zero candidates and both creating a Poster client. Keyed by normalized phone;
  // an entry exists only while a lookup-or-create is in flight for that phone and is always removed
  // in `finally` (see findOrCreateByPhone), so this is never a permanent lock. This protects only
  // THIS backend process — running more than one backend instance concurrently would need a durable
  // lock (a DB row, an advisory lock) instead, which this codebase does not have today.
  private readonly inFlight = new Map<string, Promise<PosterClientLinkOutcome>>();

  constructor(
    private readonly poster: PosterService,
    private readonly config: ConfigService,
  ) {}

  // Exact-phone candidates only. Names are NEVER used to match (two people can share a name), and the
  // digit comparison is done here rather than trusting Poster's filter. 0 = no match, 1 = one exact
  // match, >1 = ambiguous (staff must choose; nothing is ever auto-selected).
  async findCandidatesByPhone(phone: string): Promise<PosterClientCandidate[]> {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return [];
    const rows = await this.poster.getClientsByPhone(`+${digits}`);
    return rows
      .filter((row) => (row.phone_number ?? '').replace(/\D/g, '') === digits)
      .map((row) => ({
        clientId: String(row.client_id),
        displayName: safeDisplayName([row.firstname, row.lastname]),
        phoneLast4: digits.slice(-4),
      }));
  }

  // Phase 25 — automatic link for Telegram registration. `displayNameForCreate` is only used if a
  // NEW Poster client is created (Poster requires a non-empty name in practice — see poster.types.ts);
  // it is never used to MATCH an existing client, so rule "auto-link only on normalized phone" holds.
  // Reconciles with a fresh getClients-by-phone read after every create — the create response's
  // client_id is never trusted alone, matching the reconciliation discipline Phase 22's mutation uses.
  async findOrCreateByPhone(normalizedPhone: string, displayNameForCreate: string): Promise<PosterClientLinkOutcome> {
    const existing = this.inFlight.get(normalizedPhone);
    if (existing) return existing;
    const task = this.doFindOrCreate(normalizedPhone, displayNameForCreate).finally(() => this.inFlight.delete(normalizedPhone));
    this.inFlight.set(normalizedPhone, task);
    return task;
  }

  private async doFindOrCreate(normalizedPhone: string, displayNameForCreate: string): Promise<PosterClientLinkOutcome> {
    let before: PosterClientCandidate[];
    try {
      before = await this.findCandidatesByPhone(normalizedPhone);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Poster lookup failed during auto-link: ${reason}`);
      return { kind: 'FAILED', reason: `lookup failed: ${reason}` };
    }
    if (before.length === 1) return { kind: 'FOUND', clientId: before[0].clientId };
    if (before.length > 1) {
      this.logger.log(`Poster auto-link ambiguous: ${before.length} existing candidates for one phone.`);
      return { kind: 'AMBIGUOUS' };
    }

    const groupId = this.config.env.POSTER_DEFAULT_CLIENT_GROUP_ID;
    if (!groupId) {
      this.logger.warn('Cannot create a Poster client: POSTER_DEFAULT_CLIENT_GROUP_ID is not configured.');
      return { kind: 'FAILED', reason: 'POSTER_DEFAULT_CLIENT_GROUP_ID is not configured' };
    }

    const created = await this.poster.createClient({ phone: normalizedPhone, client_name: displayNameForCreate, client_groups_id_client: groupId });
    if (created.kind !== 'success') {
      this.logger.warn(`Poster createClient ${created.kind}: ${created.reason}`);
      return { kind: 'FAILED', reason: created.reason };
    }

    let after: PosterClientCandidate[];
    try {
      after = await this.findCandidatesByPhone(normalizedPhone);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Poster reconciliation read failed after creating client_id=${created.clientId}: ${reason}`);
      return { kind: 'FAILED', reason: `reconciliation read failed after create: ${reason}` };
    }
    if (after.length === 1) return { kind: 'FOUND', clientId: after[0].clientId };
    if (after.length === 0) {
      this.logger.warn(`Poster createClient reported success (client_id=${created.clientId}) but a follow-up phone lookup found nothing.`);
      return { kind: 'FAILED', reason: `created client_id=${created.clientId} not found on reconciliation read` };
    }
    this.logger.warn(`Poster reconciliation found ${after.length} candidates after creating client_id=${created.clientId}.`);
    return { kind: 'AMBIGUOUS' };
  }
}

// Poster often stores the customer's PHONE NUMBER as their name (e.g. a client auto-created from an online
// order). Staff must never see a full phone through this list, so any run of 7+ phone-like characters is
// masked; if nothing meaningful is left, a neutral dash is shown.
function safeDisplayName(parts: (string | null | undefined)[]): string {
  const joined = parts
    .filter((part): part is string => !!part && part.trim() !== '')
    .join(' ')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, '•••')
    .trim();
  return joined === '' || joined === '•••' ? '—' : joined;
}
