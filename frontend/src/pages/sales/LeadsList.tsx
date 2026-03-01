import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, SlidersHorizontal, Trash2, ChevronRight, Plus } from 'lucide-react';
import api from '../../utils/api';
import { Lead, LeadStatus } from '../../types';
import { LeadStatusBadge } from '../../components/StatusBadge';
import { formatDate, formatCurrency, LEAD_STATUS_CONFIG, minutesSince } from '../../utils/helpers';
import { useAuth } from '../../contexts/AuthContext';

const STATUSES = Object.keys(LEAD_STATUS_CONFIG) as LeadStatus[];

export default function LeadsList() {
  const { user } = useAuth();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/management') ? '/management' : '/sales';

  async function handleDelete(lead: Lead) {
    if (!window.confirm(`Delete lead "${lead.customer_name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/leads/${lead.id}`);
      setLeads(prev => prev.filter(l => l.id !== lead.id));
    } catch {
      alert('Failed to delete lead.');
    }
  }

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('');
  const [showFilters, setShowFilters] = useState(false);

  const fetchLeads = async () => {
    setLoading(true);
    const params: any = {};
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    const res = await api.get('/leads', { params });
    setLeads(res.data);
    setLoading(false);
  };

  useEffect(() => { fetchLeads(); }, [search, statusFilter]);

  const canCreate = user?.role === 'sales' || user?.role === 'management';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Leads</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`btn-ghost btn ${showFilters || statusFilter ? 'bg-blue-50 text-blue-600' : ''} md:hidden btn-sm`}
          >
            <SlidersHorizontal size={15} />
          </button>
          {canCreate && (
            <Link to={`${basePath}/leads/new`} className="btn-primary btn-sm md:btn">
              <Plus size={15} className="shrink-0" />
              <span className="hidden sm:inline">New Lead</span>
              <span className="sm:hidden">New</span>
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className={`gap-3 flex-wrap ${showFilters ? 'flex' : 'hidden md:flex'}`}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search name, company, lead #..."
            className="form-input pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="form-select md:w-48" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{LEAD_STATUS_CONFIG[s].label}</option>)}
        </select>
        <div className="text-sm text-gray-400 flex items-center font-medium">{leads.length} leads</div>
      </div>

      {/* ── Mobile Card List ── */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading...</div>
        ) : leads.length === 0 ? (
          <div className="text-center text-gray-400 py-12 card p-8">
            <div className="text-3xl mb-2">🔍</div>
            <div className="font-medium">No leads found</div>
          </div>
        ) : leads.map((lead) => (
          <Link key={lead.id} to={`${basePath}/leads/${lead.id}`} className="lead-card flex items-start gap-3 no-underline">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-blue-500 font-semibold">{lead.lead_number}</span>
                <LeadStatusBadge status={lead.status} />
                {lead.status === 'NEW' && !lead.first_contacted_at && minutesSince(lead.created_at) >= 5 && (
                  <span className="text-xs text-red-500 font-bold animate-pulse">🚨 {minutesSince(lead.created_at)}m</span>
                )}
              </div>
              <div className="font-semibold text-gray-900 mt-1 truncate">{lead.customer_name}</div>
              {lead.company && <div className="text-xs text-gray-500 truncate">{lead.company}</div>}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                {lead.product_interest && <span className="text-xs text-gray-500 truncate max-w-[160px]">{lead.product_interest}</span>}
                {lead.estimated_value ? (
                  <span className="text-xs font-semibold text-emerald-600">{formatCurrency(lead.estimated_value)}</span>
                ) : null}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-400">{formatDate(lead.created_at)}</span>
                {lead.assigned_name && (
                  <span className="text-xs text-gray-400" title="Assigned to">{lead.assigned_name}</span>
                )}
                {(lead as any).created_name && user?.role === 'sales' && (
                  <span className="text-xs text-blue-400" title="Created by">by {(lead as any).created_name}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 pt-1">
              {user?.role === 'management' && (
                <button
                  onClick={e => { e.preventDefault(); handleDelete(lead); }}
                  className="btn btn-danger btn-sm p-1.5"
                >
                  <Trash2 size={13} />
                </button>
              )}
              <ChevronRight size={16} className="text-gray-300" />
            </div>
          </Link>
        ))}
      </div>

      {/* ── Desktop Table ── */}
      <div className="card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Lead #</th>
                <th className="table-th">Customer</th>
                <th className="table-th">Company</th>
                <th className="table-th">Product</th>
                <th className="table-th">Source</th>
                <th className="table-th">Status</th>
                <th className="table-th">Value</th>
                <th className="table-th">Assigned</th>
                <th className="table-th">Created by</th>
                <th className="table-th">Created</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="table-td text-center text-gray-400 py-10">Loading...</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={10} className="table-td text-center text-gray-400 py-10">No leads found</td></tr>
              ) : leads.map((lead) => (
                <tr key={lead.id} className="table-tr">
                  <td className="table-td">
                    <span className="font-mono text-xs text-blue-600 font-semibold">{lead.lead_number}</span>
                  </td>
                  <td className="table-td font-medium whitespace-nowrap">
                    <div>{lead.customer_name}</div>
                    {lead.status === 'NEW' && !lead.first_contacted_at && minutesSince(lead.created_at) >= 5 && (
                      <div className="text-xs text-red-500 font-bold animate-pulse">🚨 {minutesSince(lead.created_at)}m</div>
                    )}
                  </td>
                  <td className="table-td text-gray-500 whitespace-nowrap">{lead.company || '—'}</td>
                  <td className="table-td max-w-[180px] truncate text-gray-600">
                    <div className="truncate">{lead.product_interest}</div>
                    {lead.product_type && <div className="text-xs text-gray-400">{lead.product_type}</div>}
                  </td>
                  <td className="table-td text-gray-500 capitalize whitespace-nowrap">{lead.source.replace('_', ' ')}</td>
                  <td className="table-td whitespace-nowrap"><LeadStatusBadge status={lead.status} /></td>
                  <td className="table-td whitespace-nowrap font-medium">{formatCurrency(lead.estimated_value)}</td>
                  <td className="table-td text-gray-500 whitespace-nowrap">{lead.assigned_name || '—'}</td>
                  <td className="table-td text-gray-500 whitespace-nowrap">{(lead as any).created_name || '—'}</td>
                  <td className="table-td text-gray-400 whitespace-nowrap">{formatDate(lead.created_at)}</td>
                  <td className="table-td whitespace-nowrap">
                    <div className="flex gap-1">
                      <Link to={`${basePath}/leads/${lead.id}`} className="btn-secondary btn-sm">View</Link>
                      {user?.role === 'management' && (
                        <button onClick={() => handleDelete(lead)} className="btn btn-danger btn-sm p-1.5"><Trash2 size={13} /></button>
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
