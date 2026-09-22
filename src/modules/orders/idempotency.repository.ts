import { Injectable } from '@nestjs/common';
import { IdempotencyStatus } from '../../common/enums/idempotency-status';
import { Db, PrismaService } from '../../common/prisma/prisma.service';

export interface CreateIdempotencyKeyData {
  key: string;
  scope: string;
  requestHash: string;
  orderId: string;
}

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByKey(key: string) {
    return this.prisma.idempotencyKey.findUnique({ where: { key } });
  }

  create(db: Db, data: CreateIdempotencyKeyData) {
    return db.idempotencyKey.create({
      data: { ...data, status: 'in_progress' satisfies IdempotencyStatus },
    });
  }

  markInProgress(db: Db, key: string) {
    return db.idempotencyKey.update({
      where: { key },
      data: { status: 'in_progress' satisfies IdempotencyStatus },
    });
  }

  markCompleted(db: Db, key: string, responseSnapshot: string) {
    return db.idempotencyKey.update({
      where: { key },
      data: { status: 'completed' satisfies IdempotencyStatus, responseSnapshot },
    });
  }

  markFailed(db: Db, key: string) {
    return db.idempotencyKey.update({
      where: { key },
      data: { status: 'failed' satisfies IdempotencyStatus },
    });
  }

  markUncertain(db: Db, key: string) {
    return db.idempotencyKey.update({
      where: { key },
      data: { status: 'uncertain' satisfies IdempotencyStatus },
    });
  }
}
