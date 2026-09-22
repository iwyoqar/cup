import { apiRequest } from './api';
import { Segment, SegmentCondition, SegmentListPage, SegmentMatchingCustomersPage } from './types';

export interface SegmentInput {
  name: string;
  description?: string;
  logic: 'AND' | 'OR';
  conditions: SegmentCondition[];
  isActive?: boolean;
}

export function fetchSegments(cursor?: string): Promise<SegmentListPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<SegmentListPage>(`/admin/segments${query}`);
}

export function fetchSegment(id: string): Promise<Segment> {
  return apiRequest<Segment>(`/admin/segments/${id}`);
}

export function createSegment(input: SegmentInput): Promise<Segment> {
  return apiRequest<Segment>('/admin/segments', { method: 'POST', body: input });
}

export function updateSegment(id: string, input: Partial<SegmentInput>): Promise<Segment> {
  return apiRequest<Segment>(`/admin/segments/${id}`, { method: 'PATCH', body: input });
}

export function deleteSegment(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/admin/segments/${id}`, { method: 'DELETE' });
}

export function fetchSegmentCustomers(id: string, cursor?: string): Promise<SegmentMatchingCustomersPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<SegmentMatchingCustomersPage>(`/admin/segments/${id}/customers${query}`);
}
