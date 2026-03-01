import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../../utils/api';
import { ProductionOrder, OrderStatus } from '../../types';
import { OrderStatusBadge, PriorityBadge } from '../../components/StatusBadge';
import { formatDate, formatCurrency, ORDER_STATUS_CONFIG } from '../../utils/helpers';

const STATUSES = Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[];

export default function OrdersList() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const location = useLocation();
  const basePath = location.pathname.startsWith('/management') ? '/management' : '/production';

  const fetchOrders = () => {
    setLoading(true);
    const params: any = {};
    if (statusFilter) params.status = statusFilter;
    api.get('/production', { params }).then(r => setOrders(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrders(); }, [statusFilter]);

  const handleDelete = async (o: ProductionOrder) => {
    if (!window.confirm(`Delete order ${o.order_number} for ${o.customer_name}? This cannot be undone.`)) return;
    setDeletingId(o.id);
    try {
      await api.delete(`/production/${o.id}`);
      fetchOrders();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete order');
    } finally { setDeletingId(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Production Orders</h1>
        <div className="text-sm text-gray-500">{orders.length} orders</div>
      </div>

      <div className="flex gap-3">
        <select className="form-select w-48" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
          <option value="">All Stages</option>
          {STATUSES.map(s => <option key={s} value={s}>{ORDER_STATUS_CONFIG[s].label}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Order #</th>
                <th className="table-th">Customer</th>
                <th className="table-th">Product</th>
                <th className="table-th">Value</th>
                <th className="table-th">Priority</th>
                <th className="table-th">Status</th>
                <th className="table-th">Delivery</th>
                <th className="table-th">Updated</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="table-td text-center text-gray-400 py-8">Loading...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={9} className="table-td text-center text-gray-400 py-8">No orders found</td></tr>
              ) : orders.map((o) => (
                <tr key={o.id} className="table-tr">
                  <td className="table-td"><span className="font-mono text-xs text-blue-600">{o.order_number}</span></td>
                  <td className="table-td font-medium">{o.customer_name}</td>
                  <td className="table-td text-gray-500 max-w-xs truncate">{o.product_interest}</td>
                  <td className="table-td">{formatCurrency(o.amount)}</td>
                  <td className="table-td"><PriorityBadge priority={o.priority} /></td>
                  <td className="table-td"><OrderStatusBadge status={o.status} /></td>
                  <td className="table-td text-gray-400">{formatDate(o.expected_delivery_date)}</td>
                  <td className="table-td text-gray-400">{formatDate(o.updated_at)}</td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      <Link to={`${basePath}/orders/${o.id}`} className="btn-secondary btn-sm">Manage</Link>
                      {basePath === '/management' && (
                        <button
                          onClick={() => handleDelete(o)}
                          disabled={deletingId === o.id}
                          className="btn btn-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                        >{deletingId === o.id ? '…' : '🗑'}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
