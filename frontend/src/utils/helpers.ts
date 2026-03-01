import { LeadStatus, OrderStatus } from '../types';

/**
 * Parses a SQLite datetime string stored in IST (no timezone marker) as IST.
 * e.g. "2026-01-15 10:30:00" → treated as 10:30 IST
 */
export function parseIST(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  const normalized = dateStr.replace(' ', 'T');
  // Already has a timezone marker (Z or ±HH:MM) — parse as-is
  if (/[Z+]/.test(normalized.slice(-6))) return new Date(normalized);
  // If only a date (no 'T'), add midnight time before timezone
  const withTime = normalized.includes('T') ? normalized : normalized + 'T00:00:00';
  return new Date(withTime + '+05:30');
}

/** Returns today's date as YYYY-MM-DD in IST (for form defaults etc.) */
export function todayIST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

export function formatDate(date?: string): string {
  if (!date) return '—';
  return parseIST(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function formatDateTime(date?: string): string {
  if (!date) return '—';
  return parseIST(date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function formatCurrency(value?: number): string {
  if (value === undefined || value === null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

export function isOverdue(date?: string): boolean {
  if (!date) return false;
  return parseIST(date) < new Date();
}

export function formatTimeSince(date?: string): string {
  if (!date) return '';
  const diffMs = Date.now() - parseIST(date).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function minutesSince(date?: string): number {
  if (!date) return 0;
  return Math.floor((Date.now() - parseIST(date).getTime()) / 60000);
}

export const LEAD_STATUS_CONFIG: Record<LeadStatus, { label: string; color: string }> = {
  NEW:               { label: 'New',              color: 'badge-blue' },
  CONTACTED:         { label: 'Contacted',         color: 'badge-purple' },
  QUOTATION_SENT:    { label: 'Quotation Sent',    color: 'badge-yellow' },
  FOLLOW_UP:         { label: 'Follow-Up',         color: 'badge-orange' },
  NEGOTIATION:       { label: 'Negotiation',       color: 'badge-orange' },
  PARTIAL_PAYMENT:   { label: 'Partial Payment',   color: 'badge-orange' },
  PAYMENT_CONFIRMED: { label: 'Payment Confirmed', color: 'badge-green' },
  CLOSED:            { label: 'Closed ✓',          color: 'badge-green' },
  LOST:              { label: 'Lost',              color: 'badge-red' },
};

export const ORDER_STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; step: number }> = {
  PENDING:      { label: 'Pending',      color: 'badge-gray',   step: 1 },
  FABRICATION:  { label: 'Fabrication',  color: 'badge-blue',   step: 2 },
  ASSEMBLY:     { label: 'Assembly',     color: 'badge-purple', step: 3 },
  TESTING:      { label: 'Testing',      color: 'badge-yellow', step: 4 },
  PACKAGING:    { label: 'Packaging',    color: 'badge-orange', step: 5 },
  DISPATCHED:   { label: 'Dispatched',   color: 'badge-blue',   step: 6 },
  INSTALLATION: { label: 'Installation', color: 'badge-purple', step: 7 },
  COMPLETED:    { label: 'Completed ✓',  color: 'badge-green',  step: 8 },
};

export const LEAD_SOURCES = ['referral', 'website', 'cold_call', 'exhibition', 'social_media', 'other'];
export const FOLLOWUP_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'other'];
export const PRODUCT_TYPES = ['Vending Machine', 'Incinerator', 'Both'];
export const LOST_REASONS = [
  'Price too high',
  'Chose competitor',
  'Budget constraints',
  'Requirement changed',
  'Delayed purchase',
  'No response',
  'Not required anymore',
  'Other',
];
