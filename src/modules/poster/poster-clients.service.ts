import { Injectable } from '@nestjs/common';
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

// Phase 11 — Poster customer matching, READ-ONLY. All Poster HTTP still goes through PosterService;
// this is the domain adapter on top of it. It never creates or modifies a Poster client.
@Injectable()
export class PosterClientsService {
  constructor(private readonly poster: PosterService) {}

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
