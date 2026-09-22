import { Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ConfigService } from '../../common/config/config.service';
import { cleanId, normalizeAccount, PosAuthResult, POSTER_HEADER, signatureMatches } from './pos-widget-signature';

const header = (req: FastifyRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

// Phase 21 — decides whether a request really came through Poster (Poster.makeRequest is proxied by Poster's servers, which sign it with the application
// secret). The secret never leaves the server: it is not in the widget bundle, not in any response and not in any log line. Nothing the browser says about who
// it is (customer, account, spot) is trusted — only a verified signature, a fresh timestamp and the pinned account.
@Injectable()
export class PosWidgetAuthService {
  private readonly logger = new Logger(PosWidgetAuthService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.env.POS_WIDGET_ENABLED;
  }

  authenticate(req: FastifyRequest, now: Date = new Date()): PosAuthResult {
    const env = this.config.env;
    const signature = header(req, POSTER_HEADER.signature);
    const signaturePresent = !!signature;
    if (!env.POS_WIDGET_ENABLED) return { ok: false, reason: 'DISABLED', signaturePresent };
    // Enabled but not configured (no secret / no pinned account) is refused, never "open".
    if (!env.POSTER_APPLICATION_SECRET || !env.POS_WIDGET_ACCOUNT) return { ok: false, reason: 'NOT_CONFIGURED', signaturePresent };

    const time = header(req, POSTER_HEADER.time);
    if (!signature || !time || !/^\d{9,12}$/.test(time)) return this.fail('MISSING_SIGNATURE', signaturePresent);
    if (Math.abs(now.getTime() / 1000 - Number(time)) > env.POS_WIDGET_SIGNATURE_MAX_AGE) return this.fail('STALE_TIMESTAMP', signaturePresent);

    // GET: Poster's documented formula excludes the body from the signature (verified live against the real register — every GET so far matched with
    // `body` omitted). Phase 22 introduces the first POST (rewards/redeem); `expectedSignature()` already implements the documented formula's body term
    // for exactly this case (JSON.stringify(body) included when a body is present) — it has simply never been exercised against a real Poster POST. Only
    // for a POST do we pass the parsed body through; GET keeps the EXACT same `undefined` it always used, so this changes nothing for GET whatsoever.
    // docs/PHASE-22-AUDIT.md §7: whether Poster's real POST signs the body exactly this way remains UNVERIFIED — this is the documented formula, not a
    // confirmed one, and POS_REWARD_REDEMPTION_ENABLED stays off in the real environment until it is.
    const body = req.method === 'POST' ? req.body : undefined;
    if (!signatureMatches(this.candidateUrls(req), body, time, signature, env.POSTER_APPLICATION_SECRET)) return this.fail('BAD_SIGNATURE', signaturePresent);

    // The signature proves the request was signed with OUR application secret; the account pin makes sure it came from OUR Poster account (another account that
    // installed the same application would sign with the same secret).
    if (normalizeAccount(header(req, POSTER_HEADER.url)) !== normalizeAccount(env.POS_WIDGET_ACCOUNT)) return this.fail('WRONG_ACCOUNT', signaturePresent);

    return { ok: true, context: { account: normalizeAccount(env.POS_WIDGET_ACCOUNT), spotId: cleanId(header(req, POSTER_HEADER.spot)), tabletId: cleanId(header(req, POSTER_HEADER.tablet)) } };
  }

  // The full URL Poster signed: the configured public base URL + the path and query exactly as received, and the scheme / host the proxy reports.
  private candidateUrls(req: FastifyRequest): string[] {
    const path = req.url;
    const out: string[] = [];
    const base = this.config.env.POS_WIDGET_PUBLIC_URL?.replace(/\/+$/, '');
    if (base) out.push(base + path);
    const proto = (header(req, 'x-forwarded-proto') ?? 'https').split(',')[0].trim();
    const host = (header(req, 'x-forwarded-host') ?? header(req, 'host') ?? '').split(',')[0].trim();
    if (host) out.push(`${proto}://${host}${path}`);
    return out;
  }

  private fail(reason: 'MISSING_SIGNATURE' | 'STALE_TIMESTAMP' | 'BAD_SIGNATURE' | 'WRONG_ACCOUNT', signaturePresent: boolean): PosAuthResult {
    this.logger.warn(`POS widget request rejected: ${reason}`); // the reason only — never a header value, a URL or a secret
    return { ok: false, reason, signaturePresent };
  }
}
