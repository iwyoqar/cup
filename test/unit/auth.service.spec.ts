import { ConfigService } from '../../src/common/config/config.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { SessionService } from '../../src/modules/auth/session.service';
import { TelegramAccountsRepository } from '../../src/modules/auth/telegram-accounts.repository';
import { CustomersRepository } from '../../src/modules/customers/customers.repository';
import { buildValidInitData } from '../telegram-test-vectors';

const BOT_TOKEN = 'test-only-fake-bot-token-000000000000';

describe('AuthService.authenticateTelegram', () => {
  function buildService(overrides?: { telegramAccountsRepository?: Record<string, jest.Mock> }) {
    const telegramAccountsRepository = {
      findByTelegramUserId: jest.fn().mockResolvedValue(null),
      createWithCustomer: jest.fn().mockResolvedValue({
        customer: { id: 'customer-1', displayName: 'Test User', phone: null },
        telegramAccount: { telegramUserId: '111', chatId: '111' },
      }),
      updateProfile: jest.fn(),
      findByCustomerId: jest.fn(),
      ...overrides?.telegramAccountsRepository,
    } as unknown as TelegramAccountsRepository;

    const customersRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'customer-1', displayName: 'Test User', phone: null }),
    } as unknown as CustomersRepository;

    const sessionService = {
      issue: jest.fn().mockReturnValue('signed.jwt.token'),
      verify: jest.fn(),
    } as unknown as SessionService;

    const service = new AuthService(telegramAccountsRepository, customersRepository, sessionService, new ConfigService());
    return { service, telegramAccountsRepository, customersRepository, sessionService };
  }

  it('creates a new Customer+TelegramAccount for a first-time Telegram user', async () => {
    const { service, telegramAccountsRepository, sessionService } = buildService();
    const initData = buildValidInitData({ telegramUserId: 111 }, BOT_TOKEN);

    const result = await service.authenticateTelegram(initData);

    expect(telegramAccountsRepository.createWithCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUserId: '111', chatId: '111', displayName: 'Test User' }),
    );
    expect(sessionService.issue).toHaveBeenCalledWith('customer-1');
    expect(result).toEqual({
      sessionToken: 'signed.jwt.token',
      customer: { id: 'customer-1', displayName: 'Test User', phone: null, telegramUserId: '111' },
    });
  });

  it('updates the existing TelegramAccount profile on repeat login, never creates a new customer', async () => {
    const { service, telegramAccountsRepository } = buildService({
      telegramAccountsRepository: {
        findByTelegramUserId: jest.fn().mockResolvedValue({
          customer: { id: 'customer-9', displayName: 'Old Name', phone: '+1' },
          telegramAccount: { telegramUserId: '222', chatId: '222' },
        }),
        updateProfile: jest.fn().mockResolvedValue({ telegramUserId: '222', chatId: '222', username: 'updatedname' }),
        createWithCustomer: jest.fn(),
      },
    });
    const initData = buildValidInitData({ telegramUserId: 222, username: 'updatedname' }, BOT_TOKEN);

    const result = await service.authenticateTelegram(initData);

    expect(telegramAccountsRepository.createWithCustomer).not.toHaveBeenCalled();
    expect(telegramAccountsRepository.updateProfile).toHaveBeenCalledWith(
      '222',
      expect.objectContaining({ username: 'updatedname' }),
    );
    expect(result.customer.id).toBe('customer-9');
  });

  it('a concurrent first-login race: the loser re-reads the winner instead of erroring or creating a duplicate', async () => {
    const winnerRow = {
      customer: { id: 'customer-winner', displayName: 'Winner', phone: null },
      telegramAccount: { telegramUserId: '333', chatId: '333' },
    };
    const findByTelegramUserId = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winnerRow);
    const createWithCustomer = jest.fn().mockRejectedValue({ code: 'P2002' });

    const { service } = buildService({
      telegramAccountsRepository: { findByTelegramUserId, createWithCustomer },
    });
    const initData = buildValidInitData({ telegramUserId: 333 }, BOT_TOKEN);

    const result = await service.authenticateTelegram(initData);

    expect(result.customer.id).toBe('customer-winner');
    expect(findByTelegramUserId).toHaveBeenCalledTimes(2);
  });

  it('propagates a non-P2002 error from createWithCustomer rather than swallowing it', async () => {
    const { service } = buildService({
      telegramAccountsRepository: { createWithCustomer: jest.fn().mockRejectedValue(new Error('db is on fire')) },
    });
    const initData = buildValidInitData({ telegramUserId: 444 }, BOT_TOKEN);

    await expect(service.authenticateTelegram(initData)).rejects.toThrow('db is on fire');
  });

  it('rejects invalid initData before ever touching the repository', async () => {
    const { service, telegramAccountsRepository } = buildService();

    await expect(service.authenticateTelegram('garbage')).rejects.toThrow();
    expect(telegramAccountsRepository.findByTelegramUserId).not.toHaveBeenCalled();
  });
});

describe('AuthService.getPublicProfile', () => {
  it('returns only the public profile shape — never posterClientId or other internal fields', async () => {
    const telegramAccountsRepository = {
      findByCustomerId: jest.fn().mockResolvedValue({ telegramUserId: '555' }),
    } as unknown as TelegramAccountsRepository;
    const customersRepository = {
      findById: jest.fn().mockResolvedValue({
        id: 'customer-5',
        displayName: 'Five',
        phone: '+998900000000',
        posterClientId: 'poster-5',
      }),
    } as unknown as CustomersRepository;
    const service = new AuthService(
      telegramAccountsRepository,
      customersRepository,
      {} as SessionService,
      new ConfigService(),
    );

    const profile = await service.getPublicProfile('customer-5');

    expect(profile).toEqual({ id: 'customer-5', displayName: 'Five', phone: '+998900000000', telegramUserId: '555' });
    expect(profile).not.toHaveProperty('posterClientId');
  });
});
