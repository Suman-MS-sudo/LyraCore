import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../../utils/api';
import { formatDate, formatCurrency, ORDER_STATUS_CONFIG } from '../../utils/helpers';
import { OrderStatusBadge, PriorityBadge } from '../../components/StatusBadge';
import { OrderStatus } from '../../types';

interface ProdSummary {
  ordersByStatus: { status: string; count: number }[];
  totalOrders: number;
  delayedFabrication: number;
  testingFailures: number;
  pendingDispatch: number;
  recentOrders: any[];
  delayedOrders: any[];
}

export default function ProductionDashboard() {
  const [data, setData] = useState<ProdSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const basePath = location.pathname.startsWith('/management') ? '/management' : '/production';

  useEffect(() => {
    api.get('/dashboard/production').then(r => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400">Loading...</div>;
  if (!data) return null;

  const stats = [
    { label: 'Total Orders',       value: data.totalOrders,         color: 'text-blue-600',   bg: 'bg-blue-50' },
    { label: 'Delayed Fabrication', value: data.delayedFabrication,  color: 'text-red-600',    bg: 'bg-red-50'  },
    { label: 'Testing Failures',   value: data.testingFailures,     color: 'text-amber-600',  bg: 'bg-amber-50'},
    { label: 'Ready to Dispatch',  value: data.pendingDispatch,     color: 'text-green-600',  bg: 'bg-green-50'},
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Production Dashboard</h1>
        <Link to={`${basePath}/orders`} className="btn-secondary">View All Orders →</Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`card p-3 ${s.bg}`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-600 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Orders by status */}
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-gray-800">Pipeline by Stage</h2>
          </div>
          <div className="card-body space-y-2">
            {data.ordersByStatus.map((s) => {
              const config = ORDER_STATUS_CONFIG[s.status as OrderStatus];
              return (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-24 shrink-0"><span className={config?.color || 'badge-gray'}>{config?.label || s.status}</span></div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${Math.min((s.count / Math.max(data.totalOrders, 1)) * 100, 100)}%` }} />
                  </div>
                  <div className="w-5 text-xs font-semibold text-gray-700">{s.count}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Delayed */}
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-gray-800">⚠️ Delayed Orders</h2>
            <span className="badge-red">{data.delayedOrders.length}</span>
          </div>
          <div className="card-body">
            {data.delayedOrders.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">No delayed orders 🎉</div>
            ) : (
              <div className="space-y-2">
                {data.delayedOrders.slice(0, 5).map((o: any) => (
                  <div key={o.id} className="flex items-center justify-between p-2 bg-red-50 rounded border border-red-100">
                    <div>
                      <div className="font-mono text-xs text-red-600">{o.order_number}</div>
                      <div className="text-xs text-gray-700">{o.customer_name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-red-500">Due: {formatDate(o.expected_delivery_date)}</div>
                      <OrderStatusBadge status={o.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-gray-800">Recent Orders</h2>
          <Link to={`${basePath}/orders`} className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Order #</th>
                <th className="table-th">Customer</th>
                <th className="table-th">Product</th>
                <th className="table-th">Priority</th>
                <th className="table-th">Status</th>
                <th className="table-th">Delivery</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.map((o: any) => (
                <tr key={o.id} className="table-tr">
                  <td className="table-td"><span className="font-mono text-xs text-blue-600">{o.order_number}</span></td>
                  <td className="table-td font-medium">{o.customer_name}</td>
                  <td className="table-td text-gray-500 max-w-xs truncate">{o.product_interest}</td>
                  <td className="table-td"><PriorityBadge priority={o.priority} /></td>
                  <td className="table-td"><OrderStatusBadge status={o.status} /></td>
                  <td className="table-td text-gray-400">{formatDate(o.expected_delivery_date)}</td>
                  <td className="table-td">
                    <Link to={`${basePath}/orders/${o.id}`} className="btn-secondary btn-sm">View</Link>
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
