import { LeadStatus, OrderStatus } from '../types';
import { LEAD_STATUS_CONFIG, ORDER_STATUS_CONFIG } from '../utils/helpers';

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const config = LEAD_STATUS_CONFIG[status] || { label: status, color: 'badge-gray' };
  return <span className={config.color}>{config.label}</span>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const config = ORDER_STATUS_CONFIG[status] || { label: status, color: 'badge-gray', step: 0 };
  return <span className={config.color}>{config.label}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    LOW: 'badge-gray', NORMAL: 'badge-blue', HIGH: 'badge-yellow', URGENT: 'badge-red'
  };
  return <span className={colors[priority] || 'badge-gray'}>{priority}</span>;
}
