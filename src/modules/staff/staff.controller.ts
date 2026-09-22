import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentStaff } from './current-staff.decorator';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffActor, StaffAuthService } from './staff-auth.service';
import { StaffCustomersService } from './staff-customers.service';
import { StaffProfileService } from './staff-profile.service';
import { activityQuerySchema, posterLinkSchema, profileQuerySchema, staffLoginSchema } from './staff.dto';

// Phase 11 staff API. Everything except login requires a valid STAFF-audience session. This controller
// never calls Poster directly (it goes through StaffCustomersService -> PosterClientsService) and never
// exposes customer database ids: customers are addressed by their PUBLIC code only.
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staffAuthService: StaffAuthService,
    private readonly staffCustomers: StaffCustomersService,
    private readonly staffProfile: StaffProfileService,
  ) {}

  @Post('auth')
  login(@Body() body: unknown) {
    const parsed = staffLoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Username and password are required.');
    return this.staffAuthService.login(parsed.data.identifier, parsed.data.password);
  }

  @UseGuards(StaffAuthGuard)
  @Get('me')
  me(@CurrentStaff() staff: StaffActor) {
    return staff;
  }

  // The scan endpoint: ONE request -> the full customer card. Read-only by construction.
  @UseGuards(StaffAuthGuard)
  @Get('customers/by-code/:code')
  lookup(@CurrentStaff() staff: StaffActor, @Param('code') code: string) {
    return this.staffCustomers.lookupByCode(staff, code);
  }

  // Phase 16: the Staff Customer Profile — ONE composed, bounded, read-only response (identity, loyalty, rewards, promotions, referral, growth, recent
  // activity). Customers stay addressed by their PUBLIC code only. The Phase 11 by-code card above is unchanged.
  @UseGuards(StaffAuthGuard)
  @Get('customers/by-code/:code/profile')
  profile(@CurrentStaff() staff: StaffActor, @Param('code') code: string, @Query() query: Record<string, string | undefined>) {
    const parsed = profileQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid scope.');
    return this.staffProfile.getProfile(staff, code, parsed.data);
  }

  // Older activity (opaque cursor, at most 20 per page) for the same customer and scope.
  @UseGuards(StaffAuthGuard)
  @Get('customers/by-code/:code/activity')
  activity(@CurrentStaff() staff: StaffActor, @Param('code') code: string, @Query() query: Record<string, string | undefined>) {
    const parsed = activityQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid activity request.');
    return this.staffProfile.getActivity(staff, code, { ...parsed.data, limit: parsed.data.limit ? Number(parsed.data.limit) : undefined });
  }

  // The customers this staff member looked at most recently.
  @UseGuards(StaffAuthGuard)
  @Get('recent')
  recent(@CurrentStaff() staff: StaffActor) {
    return this.staffProfile.getRecent(staff);
  }

  @UseGuards(StaffAuthGuard)
  @Get('customers/search')
  search(@CurrentStaff() staff: StaffActor, @Query('query') query?: string) {
    return this.staffCustomers.search(staff, query ?? '');
  }

  @UseGuards(StaffAuthGuard)
  @Get('customers/by-code/:code/poster-candidates')
  posterCandidates(@CurrentStaff() staff: StaffActor, @Param('code') code: string) {
    return this.staffCustomers.posterCandidates(staff, code);
  }

  @UseGuards(StaffAuthGuard)
  @Post('customers/by-code/:code/poster-link')
  posterLink(@CurrentStaff() staff: StaffActor, @Param('code') code: string, @Body() body: unknown) {
    const parsed = posterLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A Poster match choice is required.');
    return this.staffCustomers.linkPosterClient(staff, code, parsed.data.choice);
  }
}
