import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../../src/common/config/config.service';
import { InvalidSessionError } from '../../src/modules/auth/auth.errors';
import { SessionService } from '../../src/modules/auth/session.service';

describe('SessionService (JWT signing/verification)', () => {
  it('issues a token that verifies back to the same customerId', () => {
    const sessionService = new SessionService(new JwtService(), new ConfigService());

    const token = sessionService.issue('customer-123');
    const payload = sessionService.verify(token);

    expect(payload.sub).toBe('customer-123');
  });

  it('rejects an already-expired token', () => {
    // JWT_EXPIRES_IN_SECONDS must be positive per the env schema, so an already-expired token
    // is signed directly via JwtService (bypassing SessionService.issue's config-driven
    // expiry) with the same real JWT_SECRET, then verified through SessionService as normal.
    const config = new ConfigService();
    const jwtService = new JwtService();
    const token = jwtService.sign({ sub: 'customer-123' }, { secret: config.env.JWT_SECRET, expiresIn: -1 });
    const sessionService = new SessionService(jwtService, config);

    expect(() => sessionService.verify(token)).toThrow(InvalidSessionError);
  });

  it('rejects a token signed with a different JWT_SECRET', () => {
    const issuer = new SessionService(new JwtService(), new ConfigService());
    const token = issuer.issue('customer-123');

    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'a-totally-different-secret-value';
    const verifier = new SessionService(new JwtService(), new ConfigService());
    const attempt = () => verifier.verify(token);
    process.env.JWT_SECRET = originalSecret;

    expect(attempt).toThrow(InvalidSessionError);
  });

  it('rejects a malformed token', () => {
    const sessionService = new SessionService(new JwtService(), new ConfigService());

    expect(() => sessionService.verify('not-a-jwt')).toThrow(InvalidSessionError);
  });
});
