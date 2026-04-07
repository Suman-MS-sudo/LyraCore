import { useEffect, useState } from 'react';
import { Calendar, DollarSign, Users, Truck } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, TooltipProps
} from 'recharts';
import api from '../../utils/api';
import { formatCurrency, formatDate } from '../../utils/helpers';

const CHART_COLORS = {
  ink: '#0f172a',
  grid: '#e2e8f0',
  leadsTotal: '#2563eb',
  leadsClosed: '#059669',
  leadsLost: '#dc2626',
  payCount: '#0ea5e9',
  payAmount: '#14b8a6',
  orderTotal: '#f59e0b',
  orderCompleted: '#10b981',
  orderProgress: '#3b82f6',
};

type TimelinePreset = '1d' | '1w' | '1m' | '1y' | 'fy' | 'custom';

type GraphType = 'leads' | 'payments' | 'orders';

interface ChartData {
  date: string;
  [key: string]: string | number;
}

interface MonthlyReportData {
  period: { fromDate: string; toDate: string };
  granularity?: 'day' | 'week' | 'month';
  availableRange?: { minDate: string | null; maxDate: string | null };
  leadsTrend: ChartData[];
  paymentsTrend: ChartData[];
  ordersTrend: ChartData[];
  leadsSummary: { total: number; closed: number; lost: number };
  paymentsSummary: { count: number; total: number };
  ordersSummary: { total: number; completed: number };
}

interface RangeState {
  fromDate: string;
  toDate: string;
  showCustom: boolean;
  activePreset: TimelinePreset;
  didAutoAdjust: boolean;
}

interface MonthlyReportProps {
  embedded?: boolean;
}

function getGranularityForRange(range: RangeState): 'day' | 'week' | 'month' {
  if (range.activePreset === '1m') return 'week';
  if (range.activePreset === '1y' || range.activePreset === 'fy') return 'month';
  if (range.activePreset === '1d' || range.activePreset === '1w') return 'day';

  const from = new Date(range.fromDate);
  const to = new Date(range.toDate);
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  if (days <= 14) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getInitialRange(): RangeState {
  const today = new Date();
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  return {
    fromDate: toInputDate(lastYear),
    toDate: toInputDate(today),
    showCustom: false,
    activePreset: '1y',
    didAutoAdjust: false,
  };
}

function buildPresetRange(type: TimelinePreset): { fromDate: string; toDate: string } {
  const now = new Date();
  let from = new Date(now);
  let to = new Date(now);

  switch (type) {
    case '1d':
      from = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      break;
    case '1w':
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '1m':
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '1y':
      from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case 'fy': {
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const fyStartYear = currentMonth >= 3 ? currentYear - 1 : currentYear - 2;
      from = new Date(fyStartYear, 3, 1);
      to = new Date(fyStartYear + 1, 2, 31);
      break;
    }
    default:
      from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  }

  return { fromDate: toInputDate(from), toDate: toInputDate(to) };
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-3 py-2 shadow-2xl border border-slate-200 bg-white/95 backdrop-blur-md text-xs">
      {label && <div className="font-semibold text-slate-700 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex gap-2">
          <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-semibold text-slate-800">{typeof p.value === 'number' && p.value > 1000 ? formatCurrency(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function MonthlyReport({ embedded = false }: MonthlyReportProps) {
  const [leadsRange, setLeadsRange] = useState<RangeState>(getInitialRange());
  const [paymentsRange, setPaymentsRange] = useState<RangeState>(getInitialRange());
  const [ordersRange, setOrdersRange] = useState<RangeState>(getInitialRange());

  const [leadsData, setLeadsData] = useState<MonthlyReportData | null>(null);
  const [paymentsData, setPaymentsData] = useState<MonthlyReportData | null>(null);
  const [ordersData, setOrdersData] = useState<MonthlyReportData | null>(null);

  const [loadingLeads, setLoadingLeads] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const applyPreset = (type: TimelinePreset, setRange: React.Dispatch<React.SetStateAction<RangeState>>) => {
    const { fromDate, toDate } = buildPresetRange(type);
    setRange(prev => ({
      ...prev,
      fromDate,
      toDate,
      activePreset: type,
      showCustom: false,
      didAutoAdjust: false,
    }));
  };

  const fetchForRange = async (
    range: RangeState,
    setRange: React.Dispatch<React.SetStateAction<RangeState>>,
    setData: React.Dispatch<React.SetStateAction<MonthlyReportData | null>>,
    setLoading: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    if (!range.fromDate || !range.toDate || new Date(range.fromDate) > new Date(range.toDate)) return;

    setLoading(true);
    try {
      const granularity = getGranularityForRange(range);
      const r = await api.get('/dashboard/monthly-report', {
        params: { fromDate: range.fromDate, toDate: range.toDate, granularity }
      });
      const nextData = r.data as MonthlyReportData;
      const isEmpty = nextData.leadsSummary.total === 0
        && nextData.paymentsSummary.count === 0
        && nextData.ordersSummary.total === 0;

      if (
        isEmpty
        && !range.didAutoAdjust
        && nextData.availableRange?.minDate
        && nextData.availableRange?.maxDate
        && (range.activePreset === '1y' || range.activePreset === 'fy')
      ) {
        setRange(prev => ({
          ...prev,
          fromDate: nextData.availableRange!.minDate!,
          toDate: nextData.availableRange!.maxDate!,
          activePreset: 'custom',
          showCustom: true,
          didAutoAdjust: true,
        }));
        return;
      }

      setData(nextData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForRange(leadsRange, setLeadsRange, setLeadsData, setLoadingLeads);
  }, [leadsRange.fromDate, leadsRange.toDate, leadsRange.activePreset]);

  useEffect(() => {
    fetchForRange(paymentsRange, setPaymentsRange, setPaymentsData, setLoadingPayments);
  }, [paymentsRange.fromDate, paymentsRange.toDate, paymentsRange.activePreset]);

  useEffect(() => {
    fetchForRange(ordersRange, setOrdersRange, setOrdersData, setLoadingOrders);
  }, [ordersRange.fromDate, ordersRange.toDate, ordersRange.activePreset]);

  const loadingAny = loadingLeads || loadingPayments || loadingOrders;
  const hasAnyData = !!(leadsData || paymentsData || ordersData);

  if (!hasAnyData && loadingAny) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const leadsSummary = leadsData?.leadsSummary || { total: 0, closed: 0, lost: 0 };
  const paymentsSummary = paymentsData?.paymentsSummary || { count: 0, total: 0 };
  const ordersSummary = ordersData?.ordersSummary || { total: 0, completed: 0 };

  const conversionRate = leadsSummary.total > 0 ? Math.round((leadsSummary.closed / leadsSummary.total) * 100) : 0;
  const orderCompletionRate = ordersSummary.total > 0 ? Math.round((ordersSummary.completed / ordersSummary.total) * 100) : 0;

  const renderRangeControls = (
    graph: GraphType,
    range: RangeState,
    setRange: React.Dispatch<React.SetStateAction<RangeState>>
  ) => (
    <div className="mb-5 space-y-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-xs font-semibold text-slate-600">{graph === 'leads' ? 'Leads' : graph === 'payments' ? 'Payments' : 'Orders'} Range:</span>
        {[
          { label: '1 Day', value: '1d' as TimelinePreset },
          { label: '1 Week', value: '1w' as TimelinePreset },
          { label: '1 Month', value: '1m' as TimelinePreset },
          { label: '1 Year', value: '1y' as TimelinePreset },
          { label: 'Previous FY', value: 'fy' as TimelinePreset },
        ].map((btn) => (
          <button
            key={`${graph}-${btn.value}`}
            onClick={() => applyPreset(btn.value, setRange)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all leading-none ${
              !range.showCustom && range.activePreset === btn.value
                ? 'bg-blue-600 text-white border-blue-700 shadow-sm hover:bg-blue-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {btn.label}
          </button>
        ))}
        <button
          onClick={() => setRange(prev => ({ ...prev, showCustom: !prev.showCustom, activePreset: 'custom' }))}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1 leading-none ${
            range.showCustom
              ? 'bg-blue-600 text-white border-blue-700 shadow-sm hover:bg-blue-700'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
          }`}
        >
          <Calendar size={12} />
          Custom
        </button>
      </div>

      <div className="text-xs text-slate-600">
        Range: {range.fromDate ? formatDate(range.fromDate) : '—'} to {range.toDate ? formatDate(range.toDate) : '—'}
      </div>

      {range.showCustom && (
        <div className="flex flex-wrap gap-3 items-end p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">From</label>
            <input
              type="date"
              value={range.fromDate}
              onChange={(e) => setRange(prev => ({
                ...prev,
                fromDate: e.target.value,
                activePreset: 'custom',
                didAutoAdjust: false,
              }))}
              className="form-input text-xs py-1.5 bg-white border-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">To</label>
            <input
              type="date"
              value={range.toDate}
              onChange={(e) => setRange(prev => ({
                ...prev,
                toDate: e.target.value,
                activePreset: 'custom',
                didAutoAdjust: false,
              }))}
              className="form-input text-xs py-1.5 bg-white border-slate-300"
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative space-y-6">
      <div className="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute top-56 -left-8 h-36 w-36 rounded-full bg-emerald-200/40 blur-3xl" />
      {!embedded && (
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">Monthly Reports</h1>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'Total Leads',
            value: leadsSummary.total,
            icon: <Users size={18} className="text-blue-600" />,
            bg: 'from-blue-50 to-white',
            subtext: `${leadsSummary.closed} closed, ${leadsSummary.lost} lost`,
          },
          {
            label: 'Conversion Rate',
            value: `${conversionRate}%`,
            icon: <Users size={18} className="text-cyan-600" />,
            bg: 'from-cyan-50 to-white',
          },
          {
            label: 'Payments',
            value: formatCurrency(paymentsSummary.total),
            icon: <DollarSign size={18} className="text-emerald-600" />,
            bg: 'from-emerald-50 to-white',
            subtext: `${paymentsSummary.count} invoices`,
          },
          {
            label: 'Orders Completed',
            value: `${ordersSummary.completed}/${ordersSummary.total}`,
            icon: <Truck size={18} className="text-amber-600" />,
            bg: 'from-amber-50 to-white',
            subtext: `${orderCompletionRate}% completion`,
          },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-2xl p-4 bg-gradient-to-br ${stat.bg} border border-slate-200 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.55)]`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-xs text-slate-600 font-semibold uppercase tracking-wide">{stat.label}</div>
                <div className="text-2xl font-black text-slate-900 mt-1 leading-none">{stat.value}</div>
                {stat.subtext && <div className="text-xs text-slate-500 mt-2">{stat.subtext}</div>}
              </div>
              {stat.icon}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3 md:mt-4">
        <div className="rounded-2xl p-5 bg-white/90 backdrop-blur-sm border border-slate-200 shadow-[0_15px_40px_-28px_rgba(15,23,42,0.7)]">
          <h3 className="font-extrabold text-slate-900 mb-2 tracking-tight">Leads Trend</h3>
          {renderRangeControls('leads', leadsRange, setLeadsRange)}
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={leadsData?.leadsTrend || []}>
              <CartesianGrid strokeDasharray="2 4" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line type="monotone" dataKey="total" stroke={CHART_COLORS.leadsTotal} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Total Leads" />
              <Line type="monotone" dataKey="closed" stroke={CHART_COLORS.leadsClosed} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Closed" />
              <Line type="monotone" dataKey="lost" stroke={CHART_COLORS.leadsLost} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Lost" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl p-5 bg-white/90 backdrop-blur-sm border border-slate-200 shadow-[0_15px_40px_-28px_rgba(15,23,42,0.7)]">
          <h3 className="font-extrabold text-slate-900 mb-2 tracking-tight">Payments Trend</h3>
          {renderRangeControls('payments', paymentsRange, setPaymentsRange)}
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={paymentsData?.paymentsTrend || []}>
              <CartesianGrid strokeDasharray="2 4" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="count" fill={CHART_COLORS.payCount} radius={[8, 8, 0, 0]} name="Payment Count" />
              <Bar yAxisId="right" dataKey="total" fill={CHART_COLORS.payAmount} radius={[8, 8, 0, 0]} name="Total Amount" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl p-5 bg-white/90 backdrop-blur-sm border border-slate-200 shadow-[0_15px_40px_-28px_rgba(15,23,42,0.7)]">
          <h3 className="font-extrabold text-slate-900 mb-2 tracking-tight">Production Orders Trend</h3>
          {renderRangeControls('orders', ordersRange, setOrdersRange)}
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={ordersData?.ordersTrend || []}>
              <CartesianGrid strokeDasharray="2 4" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="total" fill={CHART_COLORS.orderTotal} radius={[8, 8, 0, 0]} name="Total Orders" />
              <Bar dataKey="completed" fill={CHART_COLORS.orderCompleted} radius={[8, 8, 0, 0]} name="Completed" />
              <Bar dataKey="in_progress" fill={CHART_COLORS.orderProgress} radius={[8, 8, 0, 0]} name="In Progress" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl p-5 bg-white/90 backdrop-blur-sm border border-slate-200 shadow-[0_15px_40px_-28px_rgba(15,23,42,0.7)]">
          <h3 className="font-extrabold text-slate-900 mb-4 tracking-tight">Summary Table</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl border border-blue-100 bg-blue-50/60">
              <span className="text-sm font-semibold text-slate-700">Total Leads Created</span>
              <span className="font-bold text-blue-600">{leadsSummary.total}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl border border-emerald-100 bg-emerald-50/60">
              <span className="text-sm font-semibold text-slate-700">Closed Deals</span>
              <span className="font-bold text-green-600">{leadsSummary.closed}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl border border-rose-100 bg-rose-50/60">
              <span className="text-sm font-semibold text-slate-700">Lost Deals</span>
              <span className="font-bold text-red-600">{leadsSummary.lost}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl border border-teal-100 bg-teal-50/60">
              <span className="text-sm font-semibold text-slate-700">Total Payments Received</span>
              <span className="font-bold text-emerald-600">{formatCurrency(paymentsSummary.total)}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl border border-amber-100 bg-amber-50/70">
              <span className="text-sm font-semibold text-slate-700">Orders Completed</span>
              <span className="font-bold text-amber-600">{ordersSummary.completed} / {ordersSummary.total}</span>
            </div>
          </div>
        </div>
      </div>

      {!loadingAny && leadsSummary.total === 0 && paymentsSummary.count === 0 && ordersSummary.total === 0 && (
        <div className="rounded-2xl p-4 bg-amber-50 border border-amber-200 text-sm text-amber-800 shadow-[0_10px_24px_-18px_rgba(217,119,6,0.6)]">
          No data was found for the selected ranges. Try 1 Year, Previous FY, or a custom range that includes your older records.
        </div>
      )}
    </div>
  );
}
