import { useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../../utils/api';
import { formatCurrency, formatDate, formatTimeSince } from '../../utils/helpers';
import { LeadStatusBadge } from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import { Lead } from '../../types';

interface Customer {
  phone: string;
  name: string;
  email?: string;
  company?: string;
  location?: string;
  total_leads: number;
  active_leads: number;
  closed_leads: number;
  lost_leads: number;
  total_value: number;
  last_activity: string;
  first_seen: string;
  statuses: string;
}

interface CustomerDetail {
  phone: string;
  name: string;
  email?: string;
  company?: string;
  location?: string;
  leads: Lead[];
}

export default function Customers() {
  const location = useLocation();
  const basePath = location.pathname.startsWith('/management') ? '/management' : '/sales';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    const res = await api.get('/customers', { params: search ? { search } : {} });
    setCustomers(res.data);
    setLoading(false);
  }, [search]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const openCustomer = async (phone: string) => {
    setLoadingDetail(true);
    setSelected(null);  // open modal immediately with loading
    const res = await api.get(`/customers/${encodeURIComponent(phone)}`);
    setSelected(res.data);
    setLoadingDetail(false);
  };

  const statusCounts = customers.reduce(
    (acc, c) => ({ total: acc.total + c.total_leads, active: acc.active + c.active_leads, closed: acc.closed + c.closed_leads }),
    { total: 0, active: 0, closed: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Customers & Contacts</h1>
        <Link to={`${basePath}/leads/new`} className="btn btn-primary btn-sm">+ New Lead</Link>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 bg-blue-50">
          <div className="text-2xl font-bold text-blue-600">{customers.length}</div>
          <div className="text-xs text-gray-600">Total Contacts</div>
        </div>
        <div className="card p-3 bg-amber-50">
          <div className="text-2xl font-bold text-amber-600">{statusCounts.active}</div>
          <div className="text-xs text-gray-600">Active Leads</div>
        </div>
        <div className="card p-3 bg-green-50">
          <div className="text-2xl font-bold text-green-600">{statusCounts.closed}</div>
          <div className="text-xs text-gray-600">Closed Deals</div>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by name, phone, company..."
        className="form-input w-72"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Contact</th>
                <th className="table-th">Company</th>
                <th className="table-th">Phone</th>
                <th className="table-th">Leads</th>
                <th className="table-th">Total Value</th>
                <th className="table-th">Last Activity</th>
                <th className="table-th">First Seen</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="table-td text-center text-gray-400 py-8">Loading...</td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={8} className="table-td text-center text-gray-400 py-8">No contacts yet</td></tr>
              ) : customers.map((c) => (
                <tr key={c.phone} className="table-tr">
                  <td className="table-td">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                    {c.location && <div className="text-xs text-gray-400">📌 {c.location}</div>}
                  </td>
                  <td className="table-td text-gray-600">{c.company || '—'}</td>
                  <td className="table-td">
                    <div className="flex items-center gap-2">
                      <a href={`tel:${c.phone}`} className="text-blue-600 text-sm">{c.phone}</a>
                      <a href={`https://wa.me/${c.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" title="WhatsApp" className="text-green-500 text-xs">💬</a>
                    </div>
                  </td>
                  <td className="table-td">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-sm font-semibold text-gray-700">{c.total_leads}</span>
                      {c.active_leads > 0 && <span className="badge badge-blue text-xs">{c.active_leads} active</span>}
                      {c.closed_leads > 0 && <span className="badge badge-green text-xs">{c.closed_leads} closed</span>}
                      {c.lost_leads > 0 && <span className="badge badge-red text-xs">{c.lost_leads} lost</span>}
                    </div>
                  </td>
                  <td className="table-td font-semibold text-emerald-600">{formatCurrency(c.total_value)}</td>
                  <td className="table-td text-xs text-gray-500">{formatTimeSince(c.last_activity)}</td>
                  <td className="table-td text-xs text-gray-400">{formatDate(c.first_seen)}</td>
                  <td className="table-td">
                    <button onClick={() => openCustomer(c.phone)} className="btn btn-secondary btn-sm">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Detail Modal */}
      <Modal open={selected !== null || loadingDetail} onClose={() => { setSelected(null); setLoadingDetail(false); }} title={selected ? selected.name : 'Loading...'} size="lg">
        {loadingDetail && !selected ? (
          <div className="text-center py-8 text-gray-400">Loading customer details...</div>
        ) : selected && (
          <div className="space-y-4">
            {/* Contact card */}
            <div className="flex flex-wrap gap-4 bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-lg font-bold text-blue-600">
                  {selected.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{selected.name}</div>
                  {selected.company && <div className="text-xs text-gray-500">{selected.company}</div>}
                </div>
              </div>
              <div className="flex gap-3 items-center flex-wrap ml-auto">
                <a href={`tel:${selected.phone}`} className="btn btn-secondary btn-sm">📞 {selected.phone}</a>
                <a href={`https://wa.me/${selected.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">💬 WhatsApp</a>
                {selected.email && <a href={`mailto:${selected.email}`} className="btn btn-secondary btn-sm">📧 Email</a>}
              </div>
            </div>

            {/* Leads list */}
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                All Leads ({selected.leads.length})
              </div>
              <div className="space-y-2">
                {selected.leads.map((lead: any) => (
                  <div key={lead.id} className="flex items-center justify-between gap-3 p-2.5 border rounded-md hover:bg-gray-50">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-gray-400">{lead.lead_number}</span>
                      <LeadStatusBadge status={lead.status} />
                      <span className="text-sm text-gray-700">{lead.product_interest}</span>
                      {lead.product_type && <span className="text-xs text-gray-400">({lead.product_type})</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {lead.estimated_value && <span className="text-sm font-semibold text-emerald-600">{formatCurrency(lead.estimated_value)}</span>}
                      <span className="text-xs text-gray-400">{formatDate(lead.created_at)}</span>
                      <Link to={`${basePath}/leads/${lead.id}`} onClick={() => setSelected(null)} className="btn btn-secondary btn-sm">Open →</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
