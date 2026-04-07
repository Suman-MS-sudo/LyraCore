import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Area, AreaChart,
  CartesianGrid, TooltipProps
} from 'recharts';
import {
  Users, CheckCircle2, Percent, DollarSign, TrendingUp,
  Timer, AlertTriangle, Factory, ChevronRight, Bell, FileText,
  Flame, CalendarClock, TrendingDown, ArrowUpRight, ArrowDownRight,
  ClipboardList, Truck
} from 'lucide-react';
import api from '../../utils/api';
import { formatCurrency, formatDate, LEAD_STATUS_CONFIG } from '../../utils/helpers';
import { OrderStatusBadge } from '../../components/StatusBadge';
import MonthlyReport from '../sales/MonthlyReport.tsx';

const PIE_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4','#f97316','#6b7280'];

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-xl px-3 py-2 shadow-xl border border-white/10">
      {label && <div className="font-semibold mb-1 text-gray-300">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="font-bold">{typeof p.value === 'number' && p.value > 1000 ? formatCurrency(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function LeadStatusPill({ status }: { status: string }) {
  const cfg = (LEAD_STATUS_CONFIG as Record<string, { label: string; color: string }>)[status];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${cfg?.color || 'bg-gray-100 text-gray-600'}`}>
      {cfg?.label || status}
    </span>
  );
}

export default function CeoDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/ceo').then(r => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
  if (!data) return null;

  const funnelData = data.leadFunnel.map((s: any) => ({
    name: (LEAD_STATUS_CONFIG as Record<string, { label: string }>)[s.status]?.label || s.status,
    count: s.count,
  }));

  const productionData = data.productionByStatus.map((s: any) => ({ name: s.status, count: s.count }));
  const totalProduction = productionData.reduce((a: number, s: any) => a + s.count, 0);
  const activeOrders = productionData.reduce((a: number, s: any) => s.name !== 'COMPLETED' ? a + s.count : a, 0);

  const maxRevenue = Math.max(...(data.salesPerformance || []).map((sp: any) => sp.revenue || 0), 1);

  const revDiff = data.monthlyRevenue - data.lastMonthRevenue;
  const revPct = data.lastMonthRevenue > 0 ? Math.abs(Math.round((revDiff / data.lastMonthRevenue) * 100)) : null;

  const actionCount = (data.hotLeads?.length || 0) + (data.needsFollowup?.length || 0) + (data.awaitingQuotation?.length || 0);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Management Dashboard</h1>
        <div className="flex gap-2">
          <Link to="/management/leads"  className="btn-secondary btn-sm hidden sm:flex">Leads</Link>
          <Link to="/management/orders" className="btn-secondary btn-sm hidden sm:flex">Orders</Link>
          <Link to="/management/audit"  className="btn-secondary btn-sm hidden sm:flex">Audit</Link>
        </div>
      </div>

      {/* â”€â”€ KPI Row 1: Core business metrics â”€â”€ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Leads',     value: data.totalLeads,              color: 'text-blue-600',    bg: 'from-blue-50 to-blue-100/60',      icon: <Users size={17} className="text-blue-400" />,      link: '/management/leads' },
          { label: 'Closed Deals',    value: data.closedLeads,             color: 'text-emerald-600', bg: 'from-emerald-50 to-emerald-100/60', icon: <CheckCircle2 size={17} className="text-emerald-400" /> },
          { label: 'Conv. Rate',      value: `${data.conversionRate}%`,    color: 'text-purple-600',  bg: 'from-purple-50 to-purple-100/60',  icon: <Percent size={17} className="text-purple-400" /> },
          { label: 'All-time Revenue',value: formatCurrency(data.revenue), color: 'text-teal-600',    bg: 'from-teal-50 to-teal-100/60',      icon: <DollarSign size={17} className="text-teal-400" /> },
        ].map((s) => (
          <div key={s.label}
            className={`card p-3.5 bg-gradient-to-br ${s.bg} border-0 ${s.link ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
            onClick={() => s.link && (window.location.href = s.link)}>
            <div className="flex items-center justify-between mb-1.5">{s.icon}
              {s.link && <ChevronRight size={12} className="text-gray-300" />}
            </div>
            <div className={`text-2xl font-bold tracking-tight ${s.color}`}>{s.value}</div>
            <div className="text-xs font-medium text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* â”€â”€ KPI Row 2: Operational pulse â”€â”€ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* This Month Revenue with MoM trend */}
        <div className={`card p-3.5 bg-gradient-to-br border-0 ${revDiff >= 0 ? 'from-emerald-50 to-emerald-100/60' : 'from-red-50 to-red-100/60'}`}>
          <div className="flex items-center justify-between mb-1.5">
            {revDiff >= 0 ? <TrendingUp size={17} className="text-emerald-400" /> : <TrendingDown size={17} className="text-red-400" />}
          </div>
          <div className={`text-2xl font-bold tracking-tight ${revDiff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatCurrency(data.monthlyRevenue)}</div>
          <div className="text-xs font-medium text-gray-500 mt-0.5">This Month</div>
          {revPct !== null && (
            <div className={`text-[10px] font-medium mt-0.5 flex items-center gap-0.5 ${revDiff >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
              {revDiff >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
              {revDiff >= 0 ? '+' : '-'}{revPct}% vs last month
            </div>
          )}
        </div>
        {/* Today's Follow-ups */}
        <div className={`card p-3.5 bg-gradient-to-br border-0 ${data.todayFollowups > 0 ? 'from-amber-50 to-amber-100/60' : 'from-gray-50 to-gray-100/60'}`}>
          <div className="flex items-center justify-between mb-1.5">
            <Bell size={17} className={data.todayFollowups > 0 ? 'text-amber-400' : 'text-gray-400'} />
          </div>
          <div className={`text-2xl font-bold tracking-tight ${data.todayFollowups > 0 ? 'text-amber-600' : 'text-gray-500'}`}>{data.todayFollowups}</div>
          <div className="text-xs font-medium text-gray-500 mt-0.5">Today's Follow-ups</div>
          <div className="text-[10px] font-medium mt-0.5">
            {data.overdueFollowupsCount > 0
              ? <span className="text-red-400">{data.overdueFollowupsCount} overdue</span>
              : <span className="text-gray-400">none overdue</span>}
          </div>
        </div>
        {/* Active Orders */}
        <div className="card p-3.5 bg-gradient-to-br from-sky-50 to-sky-100/60 border-0 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => window.location.href = '/management/orders'}>
          <div className="flex items-center justify-between mb-1.5">
            <Factory size={17} className="text-sky-400" />
            <ChevronRight size={12} className="text-gray-300" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-sky-600">{activeOrders}</div>
          <div className="text-xs font-medium text-gray-500 mt-0.5">Active Orders</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{totalProduction} total incl. completed</div>
        </div>
        {/* Delayed Orders */}
        <div className={`card p-3.5 bg-gradient-to-br border-0 ${data.delayedOrders.length > 0 ? 'from-red-50 to-red-100/60' : 'from-emerald-50 to-emerald-100/60'}`}>
          <div className="flex items-center justify-between mb-1.5">
            <AlertTriangle size={17} className={data.delayedOrders.length > 0 ? 'text-red-400' : 'text-emerald-400'} />
          </div>
          <div className={`text-2xl font-bold tracking-tight ${data.delayedOrders.length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{data.delayedOrders.length}</div>
          <div className="text-xs font-medium text-gray-500 mt-0.5">Delayed Orders</div>
          <div className="text-[10px] font-medium mt-0.5">
            {data.delayedOrders.length > 0
              ? <span className="text-red-400">needs attention</span>
              : <span className="text-emerald-500">all on track 🎉</span>}
          </div>
        </div>
      </div>

      {/* â”€â”€ ACTION REQUIRED â”€â”€ */}
      {actionCount > 0 && (
        <div className="card overflow-hidden border border-red-100">
          <div className="card-header bg-gradient-to-r from-red-50 to-orange-50 border-b border-red-100">
            <h2 className="font-bold text-red-700 flex items-center gap-2">
              <Flame size={15} className="text-red-500" /> Action Required
            </h2>
            <span className="badge-red">{actionCount} items</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">

            {/* Hot Leads */}
            <div>
              <div className="px-4 py-2.5 bg-red-50/40 flex items-center gap-2 border-b border-red-100/60">
                <Flame size={13} className="text-red-500" />
                <span className="text-xs font-bold text-red-700">Uncontacted Leads ({data.hotLeads?.length || 0})</span>
              </div>
              {(data.hotLeads?.length || 0) === 0 ? (
                <div className="px-4 py-4 text-xs text-gray-400 italic">No uncontacted leads ✓</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {data.hotLeads.map((l: any) => (
                    <Link key={l.id} to={`/management/leads/${l.id}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-red-50/40 transition-colors">
                      <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Flame size={13} className="text-red-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-800 truncate">{l.customer_name}</div>
                        <div className="text-xs text-gray-400 truncate">{l.product_interest || '—'}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-red-400 font-medium font-mono">{l.lead_number}</span>
                          {l.assigned_name && <span className="text-[10px] text-gray-400">→ {l.assigned_name}</span>}
                        </div>
                      </div>
                      <ChevronRight size={13} className="text-gray-300 shrink-0 mt-1" />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Overdue Follow-ups */}
            <div>
              <div className="px-4 py-2.5 bg-amber-50/40 flex items-center gap-2 border-b border-amber-100/60">
                <CalendarClock size={13} className="text-amber-500" />
                <span className="text-xs font-bold text-amber-700">Overdue Follow-ups ({data.needsFollowup?.length || 0})</span>
              </div>
              {(data.needsFollowup?.length || 0) === 0 ? (
                <div className="px-4 py-4 text-xs text-gray-400 italic">All follow-ups on track ✓</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {data.needsFollowup.map((l: any) => (
                    <Link key={l.id} to={`/management/leads/${l.id}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-amber-50/40 transition-colors">
                      <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                        <CalendarClock size={13} className="text-amber-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-800 truncate">{l.customer_name}</div>
                        <div className="text-xs text-gray-400 truncate">{l.product_interest || '—'}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <LeadStatusPill status={l.status} />
                          {l.assigned_name && <span className="text-[10px] text-gray-400">{l.assigned_name}</span>}
                        </div>
                      </div>
                      <ChevronRight size={13} className="text-gray-300 shrink-0 mt-1" />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Awaiting Quotation */}
            <div>
              <div className="px-4 py-2.5 bg-blue-50/40 flex items-center gap-2 border-b border-blue-100/60">
                <FileText size={13} className="text-blue-500" />
                <span className="text-xs font-bold text-blue-700">Awaiting Quotation ({data.awaitingQuotation?.length || 0})</span>
              </div>
              {(data.awaitingQuotation?.length || 0) === 0 ? (
                <div className="px-4 py-4 text-xs text-gray-400 italic">No contacts awaiting quotes ✓</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {data.awaitingQuotation.map((l: any) => (
                    <Link key={l.id} to={`/management/leads/${l.id}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-blue-50/40 transition-colors">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                        <FileText size={13} className="text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-800 truncate">{l.customer_name}</div>
                        <div className="text-xs text-gray-400 truncate">{l.product_interest || '—'}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-400 font-mono">{l.lead_number}</span>
                          {l.assigned_name && <span className="text-[10px] text-gray-400">→ {l.assigned_name}</span>}
                        </div>
                      </div>
                      <ChevronRight size={13} className="text-gray-300 shrink-0 mt-1" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Charts Row â”€â”€ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Sales Funnel */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h2 className="font-bold text-gray-800">Sales Funnel</h2>
            <span className="text-xs text-gray-400 font-medium">{data.totalLeads} leads total</span>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={funnelData} barSize={26} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9', radius: 8 }} />
                <Bar dataKey="count" name="Leads" fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Production Donut */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h2 className="font-bold text-gray-800">Production Pipeline</h2>
            <span className="badge-blue">{totalProduction} orders</span>
          </div>
          <div className="p-4 flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={180} className="shrink-0 sm:max-w-[200px]">
              <PieChart>
                <defs>
                  {PIE_COLORS.map((c, i) => (
                    <linearGradient key={i} id={`pie${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c} stopOpacity={1} />
                      <stop offset="100%" stopColor={c} stopOpacity={0.75} />
                    </linearGradient>
                  ))}
                </defs>
                <Pie data={productionData} dataKey="count" nameKey="name"
                  cx="50%" cy="50%" innerRadius={52} outerRadius={80}
                  paddingAngle={3} strokeWidth={0}>
                  {productionData.map((_: any, i: number) => (
                    <Cell key={i} fill={`url(#pie${i})`} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1.5 w-full">
              {productionData.map((d: any, i: number) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="text-gray-600 flex-1 truncate font-medium">{d.name}</span>
                  <span className="font-bold text-gray-800">{d.count}</span>
                  {totalProduction > 0 && (
                    <span className="text-gray-400 w-8 text-right">{Math.round((d.count / totalProduction) * 100)}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card border-0 bg-transparent shadow-none p-0">
        <div className="page-header mb-4">
          <div>
            <h2 className="page-title text-lg">Timeline Reports</h2>
            <p className="text-sm text-gray-500">Leads, payments, and order trends with flexible date filters.</p>
          </div>
          <Link to="/management/reports" className="btn-secondary btn-sm md:btn">
            <FileText size={15} />
            <span>Open Full Reports</span>
          </Link>
        </div>
        <MonthlyReport embedded />
      </div>

      {/* â”€â”€ Revenue + Lead Trend Charts â”€â”€ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Monthly Revenue Trend */}
        {data.monthlyRevenueTrend?.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="font-bold text-gray-800">Monthly Revenue</h2>
              <span className="text-xs text-gray-400 font-medium">Last 6 months</span>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.monthlyRevenueTrend} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => v >= 100000 ? `${(v/100000).toFixed(1)}L` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc', radius: 4 }} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                    formatter={(v) => <span className="text-gray-500 font-medium">{v}</span>} />
                  <Bar dataKey="confirmed" name="Confirmed" fill="#10b981" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="pending"   name="Pending"   fill="#f59e0b" radius={[4, 4, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Monthly Lead Trend */}
        {data.monthlyTrend?.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="font-bold text-gray-800">Monthly Lead Trend</h2>
              <span className="text-xs text-gray-400 font-medium">Last 6 months</span>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.monthlyTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="areaClosed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                    formatter={(v) => <span className="text-gray-500 font-medium">{v}</span>} />
                  <Area type="monotone" dataKey="leads"  name="New Leads" stroke="#3b82f6" strokeWidth={2.5} fill="url(#areaLeads)"  dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  <Area type="monotone" dataKey="closed" name="Closed"    stroke="#10b981" strokeWidth={2.5} fill="url(#areaClosed)" dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* â”€â”€ Sales Performance + Recent Orders â”€â”€ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Sales Team Performance */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h2 className="font-bold text-gray-800">Sales Team Performance</h2>
          </div>
          {(data.salesPerformance || []).length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No sales data yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(data.salesPerformance || []).map((sp: any, i: number) => (
                <div key={sp.name} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 text-white ${
                    i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-gray-400' : 'bg-orange-300'
                  }`}>
                    {i < 3 ? ['🥇','🥈','🥉'][i] : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm text-gray-800 truncate">{sp.name}</span>
                      <span className="text-xs font-bold text-emerald-600 ml-2 shrink-0">{formatCurrency(sp.revenue)}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all"
                        style={{ width: `${Math.round((sp.revenue / maxRevenue) * 100)}%` }} />
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                      <span>{sp.total_leads} leads</span>
                      <span className="text-emerald-500 font-medium">✓ {sp.closed} closed</span>
                      <span className="text-red-400">✕ {sp.lost} lost</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Orders */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <Truck size={15} className="text-sky-500" /> Recent Orders
            </h2>
            <Link to="/management/orders" className="text-xs text-blue-500 hover:underline font-medium">View all →</Link>
          </div>
          {(data.recentOrders || []).length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No orders yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(data.recentOrders || []).map((o: any) => (
                <Link key={o.id} to={`/management/orders/${o.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-sky-50/40 transition-colors">
                  <div className="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                    <ClipboardList size={14} className="text-sky-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-sky-700">{o.order_number}</span>
                      <OrderStatusBadge status={o.status} />
                    </div>
                    <div className="text-sm text-gray-700 truncate font-medium">{o.customer_name}</div>
                    <div className="text-xs text-gray-400 truncate">{o.product_interest}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-gray-400">{formatDate(o.created_at)}</div>
                    {o.expected_delivery_date && (
                      <div className="text-[10px] text-gray-400 mt-0.5">Due {formatDate(o.expected_delivery_date)}</div>
                    )}
                  </div>
                  <ChevronRight size={14} className="text-gray-300 shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* â”€â”€ Delayed Orders (only if any) â”€â”€ */}
      {data.delayedOrders.length > 0 && (
        <div className="card overflow-hidden border border-red-100">
          <div className="card-header bg-red-50/60 border-b border-red-100">
            <h2 className="font-bold text-red-700 flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-500" /> Delayed Orders
            </h2>
            <span className="badge-red">{data.delayedOrders.length}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {data.delayedOrders.map((o: any) => (
              <Link key={o.order_number} to={`/management/orders/${o.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-red-50/60 transition-colors">
                <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                  <AlertTriangle size={14} className="text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-red-600">{o.order_number}</span>
                    <OrderStatusBadge status={o.status} />
                  </div>
                  <div className="text-sm text-gray-700 truncate font-medium">{o.customer_name}</div>
                  <div className="text-xs text-red-400 mt-0.5">Due: {formatDate(o.expected_delivery_date)}</div>
                </div>
                <ChevronRight size={15} className="text-gray-300 shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* â”€â”€ Secondary stat strip â”€â”€ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3.5 bg-gradient-to-br from-amber-50 to-amber-100/60 border-0">
          <div className="mb-1"><TrendingUp size={15} className="text-amber-400" /></div>
          <div className="text-xl font-bold text-amber-600">{formatCurrency(data.pipeline)}</div>
          <div className="text-xs font-medium text-gray-500 mt-0.5">Pipeline Value</div>
        </div>
        <div className="card p-3.5 bg-gradient-to-br from-indigo-50 to-indigo-100/60 border-0">
          <div className="mb-1"><FileText size={15} className="text-indigo-400" /></div>
          <div className="text-xl font-bold text-indigo-600">{data.pendingQuotationsCount}</div>
          <div className="text-xs font-medium text-gray-500 mt-0.5">Pending Quotations</div>
        </div>
        <div className="card p-3.5 bg-gradient-to-br from-orange-50 to-orange-100/60 border-0">
          <div className="mb-1"><Timer size={15} className="text-orange-400" /></div>
          <div className="text-xl font-bold text-orange-600">{data.avgFabricationDays}d</div>
          <div className="text-xs font-medium text-gray-500 mt-0.5">Avg Fabrication Days</div>
        </div>
        <div className="card p-3.5 bg-gradient-to-br from-gray-50 to-gray-100/60 border-0">
          <div className="mb-1"><Bell size={15} className="text-gray-400" /></div>
          <div className="text-xl font-bold text-gray-600">{data.overdueFollowupsCount}</div>
          <div className="text-xs font-medium text-gray-500 mt-0.5">Overdue Follow-ups</div>
        </div>
      </div>

    </div>
  );
}
