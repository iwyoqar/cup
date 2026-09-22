import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CustomersRepository } from '../customers/customers.repository';
import { InvalidSessionError } from './auth.errors';
import { SessionService } from './session.service';

// Reusable guard for every protected endpoint. Resolves the authenticated Customer strictly
// from the validated session token — never from a body/query/header-supplied customerId, so
// no endpoint using this guard can be asked to act "as" another customer.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly customersRepository: CustomersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new InvalidSessionError('Missing session token.');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new InvalidSessionError('Missing session token.');
    }

    const payload = this.sessionService.verify(token);
    const customer = await this.customersRepository.findById(payload.sub);
    if (!customer) {
      throw new InvalidSessionError('Session refers to an unknown customer.');
    }

    request.customer = customer;
    return true;
  }
}
