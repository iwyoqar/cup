import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { isAdminRole } from './staff-roles';
import { createStaffSchema, updateStaffSchema } from './staff.dto';
import { StaffRepository } from './staff.repository';

interface AuthenticatedAdmin {
  id: string;
  role: string;
}

function view(staff: { id: string; username: string; displayName: string; isActive: boolean; branch: { id: string; name: string } | null; createdAt: Date }) {
  return {
    id: staff.id,
    username: staff.username,
    displayName: staff.displayName,
    isActive: staff.isActive,
    branch: staff.branch ? { id: staff.branch.id, name: staff.branch.name } : null,
    createdAt: staff.createdAt.toISOString(),
  };
}

// Barista account management — ADMIN role only. The password hash never leaves the server.
@UseGuards(AdminAuthGuard)
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly staffRepository: StaffRepository) {}

  @Get()
  async list(@CurrentAdmin() admin: AuthenticatedAdmin) {
    this.requireAdminRole(admin);
    return (await this.staffRepository.list()).map(view);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    this.requireAdminRole(admin);
    const parsed = createStaffSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (await this.staffRepository.findByUsername(parsed.data.username)) {
      throw new ConflictException('That username is already taken.');
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const created = await this.staffRepository.create({
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      passwordHash,
      branchId: parsed.data.branchId ?? null,
    });
    return view(created);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    this.requireAdminRole(admin);
    const parsed = updateStaffSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (!(await this.staffRepository.findById(id))) throw new NotFoundException('Staff member not found.');
    const { password, ...rest } = parsed.data;
    const updated = await this.staffRepository.update(id, {
      ...rest,
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    });
    return view(updated);
  }

  private requireAdminRole(admin: AuthenticatedAdmin): void {
    if (!isAdminRole(admin.role)) throw new ForbiddenException('Admin role required.');
  }
}
