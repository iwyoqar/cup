import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsPeriod, resolveAnalyticsRange } from '../analytics/analytics-period';
import { PosterReportsService } from './poster-reports.service';

export type EmployeeSortBy = 'revenue' | 'receipts' | 'averageReceipt' | 'employeeName';

export interface EmployeesReportQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  branchId?: string;
  sortBy: EmployeeSortBy;
  sortDirection: 'asc' | 'desc';
}

export interface ReportsEmployeeRow {
  employeeId: string; // Poster user_id — the stable identity (never matched by name)
  employeeName: string;
  roleName: string | null; // from access.getEmployees, metadata only
  inEmployeeList: boolean | null; // false = not in Poster's current employee list ("Historical / Unknown"); null = list unavailable
  revenueMinor: number;
  receipts: number | null;
  averageReceiptMinor: number | null; // revenue / receipts, only when receipts is a known positive count
}

export interface ReportsEmployeesOverview {
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  source: 'POSTER';
  branchFilterSupported: false;
  available: boolean;
  unavailableReason: 'poster_unavailable' | 'malformed_response' | null;
  employeeMetadataAvailable: boolean;
  summary: { employeesWithSales: number; totalRevenueMinor: number | null; totalReceipts: number | null; averageReceiptMinor: number | null } | null;
  employees: ReportsEmployeeRow[];
  notes: string[];
}

// Reports Phase D2 — Employees. A descriptive Poster operational report: sales Poster attributes to each Poster
// employee (waiter). Poster is the only source of employee attribution — CUP orders carry no employee and are never used
// to infer one; a Poster employee is NOT a CUP StaffMember and the two are never merged. No scores, no rankings, no
// profit. Exactly one dash.getWaitersSales + one access.getEmployees per request.
@Injectable()
export class ReportsEmployeesService {
  constructor(
    private readonly posterReports: PosterReportsService,
    private readonly config: ConfigService,
  ) {}

  async getEmployees(query: EmployeesReportQuery, now: Date = new Date()): Promise<ReportsEmployeesOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    const ymd = (d: string) => d.replace(/-/g, '');
    const [sales, employees] = await Promise.all([this.posterReports.getWaitersSales(ymd(range.startDate), ymd(range.endDate)), this.posterReports.getEmployees()]);

    const notes = ['Branch-level employee attribution is not available from the current Poster report (dash.getWaitersSales has no location filter), so this report always covers all branches.'];
    const period = { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset };
    const base = { period, source: 'POSTER' as const, branchFilterSupported: false as const, employeeMetadataAvailable: employees !== null };

    if (!sales.available) return { ...base, available: false, unavailableReason: sales.reason, summary: null, employees: [], notes };

    // Poster returns a row per employee; rows with no sales at all are not "employees with sales".
    const withSales = sales.rows.filter((r) => r.revenueMinor !== 0 || (r.receipts ?? 0) > 0);
    const rows: ReportsEmployeeRow[] = withSales.map((r) => {
      const meta = employees?.get(r.employeeId);
      return {
        employeeId: r.employeeId,
        employeeName: r.name,
        roleName: meta?.roleName ?? null,
        inEmployeeList: employees ? employees.has(r.employeeId) : null,
        revenueMinor: r.revenueMinor,
        receipts: r.receipts,
        averageReceiptMinor: r.receipts && r.receipts > 0 ? Math.round(r.revenueMinor / r.receipts) : null,
      };
    });

    const totalRevenueMinor = rows.reduce((s, r) => s + r.revenueMinor, 0);
    const receiptsKnown = rows.every((r) => r.receipts !== null);
    const totalReceipts = receiptsKnown ? rows.reduce((s, r) => s + (r.receipts ?? 0), 0) : null;
    if (!employees) notes.push('Poster employee list could not be read; roles and current-employee status are not shown.');
    if (!receiptsKnown) notes.push('Poster did not report a receipt count for every employee, so total receipts and the overall average receipt are not shown.');

    return {
      ...base,
      available: true,
      unavailableReason: null,
      summary: { employeesWithSales: rows.length, totalRevenueMinor, totalReceipts, averageReceiptMinor: totalReceipts ? Math.round(totalRevenueMinor / totalReceipts) : null },
      employees: sortEmployees(rows, query.sortBy, query.sortDirection),
      notes,
    };
  }
}

// Neutral ordering only (the UI never calls this a ranking). Unknown values last; tie-break employeeId ascending.
function sortEmployees(rows: ReportsEmployeeRow[], by: EmployeeSortBy, direction: 'asc' | 'desc'): ReportsEmployeeRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const tie = (a: ReportsEmployeeRow, b: ReportsEmployeeRow) => (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0);
  return [...rows].sort((a, b) => {
    if (by === 'employeeName') return a.employeeName.localeCompare(b.employeeName) * sign || tie(a, b);
    const va = by === 'revenue' ? a.revenueMinor : by === 'receipts' ? a.receipts : a.averageReceiptMinor;
    const vb = by === 'revenue' ? b.revenueMinor : by === 'receipts' ? b.receipts : b.averageReceiptMinor;
    if (va === null || vb === null) return va === vb ? tie(a, b) : va === null ? 1 : -1;
    return (va - vb) * sign || tie(a, b);
  });
}
