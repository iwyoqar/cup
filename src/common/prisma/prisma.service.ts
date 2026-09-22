import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type PrismaTransactionClient = Prisma.TransactionClient;

// Accepted by repository methods so they can run either standalone or inside a transaction
// started via PrismaService.runTransaction(), without repositories ever choosing which.
export type Db = PrismaService | PrismaTransactionClient;

// The only file in the codebase that constructs/extends PrismaClient directly.
// Everything else (repositories) receives this service injected and never imports
// PrismaClient itself, per the Phase 0 repository-boundary rule.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async runTransaction<T>(fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction((tx) => fn(tx));
  }
}
