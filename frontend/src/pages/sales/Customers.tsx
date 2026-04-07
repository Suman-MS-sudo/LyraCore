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
  quotations: CustomerQuotation[];
}

interface CustomerQuotation {
  id: string;
  lead_id: string;
  lead_number: string;
  product_interest?: string;
  product_type?: string;
  lead_status: Lead['status'];
  pi_number: string;
  file_path?: string;
  amount: number;
  discount?: number;
  freight_charges?: number;
  installation_charges?: number;
  validity_date?: string;
  payment_confirmed: number;
  payment_type?: 'full' | 'partial' | null;
  amount_paid?: number;
  created_at: string;
}

function getQuotationGrandTotal(q: CustomerQuotation) {
  const afterDiscount = Number(q.amount || 0) - Number(q.discount || 0);
  const freight = Number(q.freight_charges || 0);
  const installation = Number(q.installation_charges || 0);

  return afterDiscount + Math.round(afterDiscount * 0.18)
    + (freight > 0 ? freight + Math.round(freight * 0.18) : 0)
    + (installation > 0 ? installation + Math.round(installation * 0.18) : 0);
}

function getQuotationPaidAmount(q: CustomerQuotation) {
  if (q.payment_confirmed) return getQuotationGrandTotal(q);
  if (q.payment_type === 'partial') return Number(q.amount_paid || 0);
  return 0;
}

function getQuotationStatus(q: CustomerQuotation) {
  if (q.payment_confirmed) {
    return { label: 'Paid', className: 'bg-green-50 text-green-700 border-green-200' };
  }
  if (q.payment_type === 'partial') {
    return { label: 'Partially Paid', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  }
  return { label: 'Awaiting Payment', className: 'bg-slate-50 text-slate-700 border-slate-200' };
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
      <Modal open={selected !== null || loadingDetail} onClose={() => { setSelected(null); setLoadingDetail(false); }} title={selected ? selected.name : 'Loading...'} size="xl">
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

            {/* Invoice table */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Invoices / Quotations ({selected.quotations.length})
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="px-2 py-1 rounded-full bg-slate-100">Total {formatCurrency(selected.quotations.reduce((sum, q) => sum + getQuotationGrandTotal(q), 0))}</span>
                  <span className="px-2 py-1 rounded-full bg-green-50 text-green-700">Paid {formatCurrency(selected.quotations.reduce((sum, q) => sum + getQuotationPaidAmount(q), 0))}</span>
                </div>
              </div>

              {selected.quotations.length === 0 ? (
                <div className="border rounded-lg py-8 text-center text-sm text-gray-400">No quotations created for this customer yet</div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="table-th">Date</th>
                          <th className="table-th">Invoice #</th>
                          <th className="table-th">Lead</th>
                          <th className="table-th">Product</th>
                          <th className="table-th">Amount</th>
                          <th className="table-th">Balance</th>
                          <th className="table-th">Status</th>
                          <th className="table-th"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.quotations.map((quotation) => {
                          const grandTotal = getQuotationGrandTotal(quotation);
                          const paidAmount = getQuotationPaidAmount(quotation);
                          const balance = Math.max(grandTotal - paidAmount, 0);
                          const status = getQuotationStatus(quotation);

                          return (
                            <tr key={quotation.id} className="table-tr">
                              <td className="table-td whitespace-nowrap text-gray-500">{formatDate(quotation.created_at)}</td>
                              <td className="table-td whitespace-nowrap">
                                <div className="font-mono text-xs font-semibold text-blue-600">{quotation.pi_number}</div>
                                <div className="text-xs text-gray-400">{quotation.lead_number}</div>
                              </td>
                              <td className="table-td whitespace-nowrap">
                                <LeadStatusBadge status={quotation.lead_status} />
                              </td>
                              <td className="table-td min-w-[220px]">
                                <div className="font-medium text-gray-800">{quotation.product_interest || '—'}</div>
                                {quotation.product_type && <div className="text-xs text-gray-400">{quotation.product_type}</div>}
                              </td>
                              <td className="table-td whitespace-nowrap font-semibold text-gray-900">{formatCurrency(grandTotal)}</td>
                              <td className="table-td whitespace-nowrap">
                                <div className={`font-semibold ${balance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                                  {balance > 0 ? formatCurrency(balance) : 'Settled'}
                                </div>
                                {paidAmount > 0 && !quotation.payment_confirmed && (
                                  <div className="text-xs text-gray-400">Paid {formatCurrency(paidAmount)}</div>
                                )}
                              </td>
                              <td className="table-td whitespace-nowrap">
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}>
                                  {status.label}
                                </span>
                              </td>
                              <td className="table-td whitespace-nowrap">
                                <div className="flex items-center gap-2 justify-end">
                                  {quotation.file_path && (
                                    <a href={`/${quotation.file_path}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">PI</a>
                                  )}
                                  <Link to={`${basePath}/leads/${quotation.lead_id}`} onClick={() => setSelected(null)} className="btn btn-secondary btn-sm">Open</Link>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
