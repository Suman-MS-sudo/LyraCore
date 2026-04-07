import { useEffect, useRef, useState } from 'react';
import { Calendar, DollarSign, Users, Truck } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, TooltipProps
} from 'recharts';
import api from '../../utils/api';
import { formatCurrency, formatDate } from '../../utils/helpers';

type TimelinePreset = '1d' | '1w' | '1m' | '1y' | 'fy' | 'custom';

interface ChartData {
  date: string;
  [key: string]: string | number;
}

interface MonthlyReportData {
  period: { fromDate: string; toDate: string };
  availableRange?: { minDate: string | null; maxDate: string | null };
  leadsTrend: ChartData[];
  paymentsTrend: ChartData[];
  ordersTrend: ChartData[];
  leadsSummary: { total: number; closed: number; lost: number };
  paymentsSummary: { count: number; total: number };
  ordersSummary: { total: number; completed: number };
}

interface MonthlyReportProps {
  embedded?: boolean;
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg border border-gray-700">
      {label && <div className="font-semibold text-gray-300 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex gap-2">
          <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="font-semibold">{typeof p.value === 'number' && p.value > 1000 ? formatCurrency(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function MonthlyReport({ embedded = false }: MonthlyReportProps) {
  const [data, setData] = useState<MonthlyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [activePreset, setActivePreset] = useState<TimelinePreset>('1y');
  const didAutoAdjustRange = useRef(false);

  const toInputDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Initialize with last 1 year so older but valid seeded data still appears.
  useEffect(() => {
    const today = new Date();
    const lastYear = new Date(today);
    lastYear.setFullYear(today.getFullYear() - 1);
    setFromDate(toInputDate(lastYear));
    setToDate(toInputDate(today));
  }, []);

  // Fetch data when dates change
  useEffect(() => {
    if (!fromDate || !toDate || new Date(fromDate) > new Date(toDate)) return;
    
    setLoading(true);
    api.get('/dashboard/monthly-report', { params: { fromDate, toDate } })
      .then(r => {
        const nextData = r.data as MonthlyReportData;
        const isEmpty = nextData.leadsSummary.total === 0
          && nextData.paymentsSummary.count === 0
          && nextData.ordersSummary.total === 0;

        if (
          isEmpty
          && !didAutoAdjustRange.current
          && nextData.availableRange?.minDate
          && nextData.availableRange?.maxDate
          && (activePreset === '1y' || activePreset === 'fy')
        ) {
          didAutoAdjustRange.current = true;
          setFromDate(nextData.availableRange.minDate);
          setToDate(nextData.availableRange.maxDate);
          setActivePreset('custom');
          setShowCustom(true);
          return;
        }

        setData(nextData);
      })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, activePreset]);

  const setTimelineRange = (type: string) => {
    const now = new Date();
    let from: Date;
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
        // Previous Indian financial year: Apr 1 to Mar 31.
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const fyStartYear = currentMonth >= 3 ? currentYear - 1 : currentYear - 2;
        from = new Date(fyStartYear, 3, 1);
        to = new Date(fyStartYear + 1, 2, 31);
        setFromDate(toInputDate(from));
        setToDate(toInputDate(to));
        setActivePreset('fy');
        setShowCustom(false);
        return;
      }
      default:
        from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    setFromDate(toInputDate(from));
    setToDate(toInputDate(to));
    setActivePreset(type as TimelinePreset);
    didAutoAdjustRange.current = false;
    setShowCustom(false);
  };

  if (!data && loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const conversionRate = (() => {
    if (!data?.leadsSummary?.total || data.leadsSummary.total === 0) return 0;
    return Math.round((data.leadsSummary.closed / data.leadsSummary.total) * 100);
  })();

  const orderCompletionRate = (() => {
    if (!data?.ordersSummary?.total || data.ordersSummary.total === 0) return 0;
    return Math.round((data.ordersSummary.completed / data.ordersSummary.total) * 100);
  })();

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-gray-900">Monthly Reports</h1>
        </div>
      )}

      {/* Timeline Selector */}
      <div className="card p-4 bg-white border border-gray-200">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-sm font-semibold text-gray-600">Quick Select:</span>
          {[
            { label: '1 Day', value: '1d' },
            { label: '1 Week', value: '1w' },
            { label: '1 Month', value: '1m' },
            { label: '1 Year', value: '1y' },
            { label: 'Previous FY', value: 'fy' },
          ].map((btn) => (
            <button
              key={btn.value}
              onClick={() => setTimelineRange(btn.value)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                !showCustom && activePreset === btn.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {btn.label}
            </button>
          ))}
          <button
            onClick={() => {
              setShowCustom(!showCustom);
              setActivePreset('custom');
            }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
              showCustom
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Calendar size={14} />
            Custom
          </button>
        </div>

        <div className="text-xs text-gray-500 mb-1">
          Range: {fromDate ? formatDate(fromDate) : '—'} to {toDate ? formatDate(toDate) : '—'}
        </div>

        {/* Custom Date Range */}
        {showCustom && (
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setActivePreset('custom');
                  didAutoAdjustRange.current = false;
                }}
                className="form-input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setActivePreset('custom');
                  didAutoAdjustRange.current = false;
                }}
                className="form-input text-sm"
              />
            </div>
            <span className="text-xs text-gray-500 px-3 py-2 bg-gray-50 rounded">
              {data?.period?.fromDate && data?.period?.toDate && (
                `${formatDate(data.period.fromDate)} to ${formatDate(data.period.toDate)}`
              )}
            </span>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: 'Total Leads',
              value: data.leadsSummary.total,
              icon: <Users size={18} className="text-blue-400" />,
              bg: 'from-blue-50 to-blue-100/60',
              subtext: `${data.leadsSummary.closed} closed, ${data.leadsSummary.lost} lost`,
            },
            {
              label: 'Conversion Rate',
              value: `${conversionRate}%`,
              icon: <Users size={18} className="text-purple-400" />,
              bg: 'from-purple-50 to-purple-100/60',
            },
            {
              label: 'Payments',
              value: formatCurrency(data.paymentsSummary.total),
              icon: <DollarSign size={18} className="text-green-400" />,
              bg: 'from-green-50 to-green-100/60',
              subtext: `${data.paymentsSummary.count} invoices`,
            },
            {
              label: 'Orders Completed',
              value: `${data.ordersSummary.completed}/${data.ordersSummary.total}`,
              icon: <Truck size={18} className="text-amber-400" />,
              bg: 'from-amber-50 to-amber-100/60',
              subtext: `${orderCompletionRate}% completion`,
            },
          ].map((stat) => (
            <div key={stat.label} className={`card p-4 bg-gradient-to-br ${stat.bg} border-0`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-xs text-gray-600 font-semibold">{stat.label}</div>
                  <div className="text-lg font-bold text-gray-900 mt-1">{stat.value}</div>
                  {stat.subtext && <div className="text-xs text-gray-500 mt-1">{stat.subtext}</div>}
                </div>
                {stat.icon}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Leads Trend */}
          <div className="card p-5 bg-white">
            <h3 className="font-semibold text-gray-900 mb-4">Leads Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.leadsTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} name="Total Leads" />
                <Line type="monotone" dataKey="closed" stroke="#10b981" strokeWidth={2} name="Closed" />
                <Line type="monotone" dataKey="lost" stroke="#ef4444" strokeWidth={2} name="Lost" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Payments Trend */}
          <div className="card p-5 bg-white">
            <h3 className="font-semibold text-gray-900 mb-4">Payments Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.paymentsTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar yAxisId="left" dataKey="count" fill="#8b5cf6" name="Payment Count" />
                <Bar yAxisId="right" dataKey="total" fill="#10b981" name="Total Amount" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Orders Trend */}
          <div className="card p-5 bg-white">
            <h3 className="font-semibold text-gray-900 mb-4">Production Orders Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.ordersTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="total" fill="#f59e0b" name="Total Orders" />
                <Bar dataKey="completed" fill="#10b981" name="Completed" />
                <Bar dataKey="in_progress" fill="#3b82f6" name="In Progress" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detailed Stats Table */}
          <div className="card p-5 bg-white">
            <h3 className="font-semibold text-gray-900 mb-4">Summary Table</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">Total Leads Created</span>
                <span className="font-bold text-blue-600">{data.leadsSummary.total}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">Closed Deals</span>
                <span className="font-bold text-green-600">{data.leadsSummary.closed}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">Lost Deals</span>
                <span className="font-bold text-red-600">{data.leadsSummary.lost}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">Total Payments Received</span>
                <span className="font-bold text-emerald-600">{formatCurrency(data.paymentsSummary.total)}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">Orders Completed</span>
                <span className="font-bold text-amber-600">{data.ordersSummary.completed} / {data.ordersSummary.total}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {data && data.leadsSummary.total === 0 && data.paymentsSummary.count === 0 && data.ordersSummary.total === 0 && (
        <div className="card p-4 bg-amber-50 border border-amber-200 text-sm text-amber-800">
          No data was found for the selected date range. Try 1 Year, Previous FY, or a custom range that includes your older records.
        </div>
      )}
    </div>
  );
}
