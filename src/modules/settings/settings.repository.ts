import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByKey(key: string) {
    return this.prisma.setting.findUnique({ where: { key } });
  }

  findByPrefix(prefix: string) {
    return this.prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
  }

  upsert(key: string, value: string, valueType: string, updatedBy: string | null) {
    return this.prisma.setting.upsert({
      where: { key },
      create: { key, value, valueType, updatedBy },
      update: { value, valueType, updatedBy },
    });
  }
}
