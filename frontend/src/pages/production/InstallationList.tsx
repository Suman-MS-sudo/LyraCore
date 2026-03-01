import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { formatDate, formatDateTime } from '../../utils/helpers';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/Modal';

interface InstallationRow {
  id: string;
  production_order_id: string;
  order_number: string;
  order_status: string;
  pi_number?: string;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  company?: string;
  product_interest?: string;
  delivery_address?: string;
  address?: string;
  location?: string;
  engineer_name?: string;
  installation_date?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  support_notes?: string;
  feedback?: string;
  rating?: number;
  completed_at?: string;
  updated_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING:     'bg-yellow-100 text-yellow-800 border border-yellow-200',
  IN_PROGRESS: 'bg-blue-100 text-blue-800 border border-blue-200',
  COMPLETED:   'bg-green-100 text-green-800 border border-green-200',
};
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed',
};

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n} type="button"
          onClick={() => onChange?.(n)}
          className={`text-lg leading-none transition-colors ${
            n <= value ? 'text-yellow-400' : 'text-gray-300'
          } ${onChange ? 'cursor-pointer hover:text-yellow-400' : 'cursor-default'}`}
        >★</button>
      ))}
    </div>
  );
}

export default function InstallationList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const basePath = location.pathname.startsWith('/management') ? '/management' : '/production';
  const canEdit = user?.role === 'production' || user?.role === 'management' || user?.role === 'installation';

  const [rows, setRows]       = useState<InstallationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [filter, setFilter]   = useState<'ALL' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>('ALL');
  const [search, setSearch]   = useState('');

  // Edit modal
  const [editRow, setEditRow]   = useState<InstallationRow | null>(null);
  const [editForm, setEditForm] = useState({ status: 'IN_PROGRESS', engineer_name: '', installation_date: '', support_notes: '', feedback: '', rating: 0 });

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<InstallationRow | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // Add modal
  const [showAdd, setShowAdd]         = useState(false);
  const [addOrderNum, setAddOrderNum] = useState('');
  const [addSearching, setAddSearching] = useState(false);
  const [addFoundOrder, setAddFoundOrder] = useState<{ id: string; order_number: string; customer_name: string } | null>(null);

  const refresh = () => api.get('/installation').then(r => setRows(r.data)).catch(() => {});

  useEffect(() => {
    api.get('/installation').then(r => setRows(r.data)).finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter(r => {
    if (filter !== 'ALL' && r.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.customer_name?.toLowerCase().includes(q) ||
        r.order_number?.toLowerCase().includes(q) ||
        r.company?.toLowerCase().includes(q) ||
        r.engineer_name?.toLowerCase().includes(q) ||
        r.pi_number?.toLowerCase().includes(q) ||
        r.product_interest?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const counts = {
    ALL: rows.length,
    PENDING: rows.filter(r => r.status === 'PENDING').length,
    IN_PROGRESS: rows.filter(r => r.status === 'IN_PROGRESS').length,
    COMPLETED: rows.filter(r => r.status === 'COMPLETED').length,
  };

  const getAddress = (r: InstallationRow) => r.delivery_address || r.address || r.location || '—';
  const getProduct = (s?: string) => {
    if (!s) return '—';
    const m = s.match(/\d+x\s+([^,(]+)/);
    return m ? m[1].trim() : s.split(',')[0].trim();
  };

  // ── Edit ──────────────────────────────────────────────────────────────────
  const openEdit = (row: InstallationRow) => {
    setEditRow(row);
    setEditForm({
      status: row.status,
      engineer_name: row.engineer_name || '',
      installation_date: row.installation_date || '',
      support_notes: row.support_notes || '',
      feedback: row.feedback || '',
      rating: row.rating || 0,
    });
  };

  const submitEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    try {
      await api.patch(`/installation/${editRow.production_order_id}`, {
        status: editForm.status,
        engineer_name: editForm.engineer_name || null,
        installation_date: editForm.installation_date || null,
        support_notes: editForm.support_notes || null,
        feedback: editForm.feedback || null,
        rating: editForm.rating || null,
      });
      toast.success('Installation updated');
      setEditRow(null);
      await refresh();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to update');
    } finally { setSaving(false); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/installation/${deleteTarget.id}`);
      toast.success('Installation record deleted');
      setDeleteTarget(null);
      await refresh();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to delete');
    } finally { setDeleting(false); }
  };

  // ── Add ───────────────────────────────────────────────────────────────────
  const searchOrder = async () => {
    if (!addOrderNum.trim()) return;
    setAddSearching(true);
    setAddFoundOrder(null);
    try {
      const r = await api.get(`/production?search=${encodeURIComponent(addOrderNum.trim())}`);
      const orders: any[] = r.data?.orders || r.data || [];
      const match = orders.find((o: any) =>
        o.order_number?.toLowerCase() === addOrderNum.trim().toLowerCase() &&
        o.status === 'INSTALLATION'
      );
      if (match) setAddFoundOrder({ id: match.id, order_number: match.order_number, customer_name: match.customer_name });
      else toast.error('No INSTALLATION-stage order found with that number');
    } catch { toast.error('Search failed'); }
    finally { setAddSearching(false); }
  };

  const createInstallation = async () => {
    if (!addFoundOrder) return;
    setSaving(true);
    try {
      await api.post('/installation', { production_order_id: addFoundOrder.id });
      toast.success('Installation record created');
      setShowAdd(false); setAddOrderNum(''); setAddFoundOrder(null);
      await refresh();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to create');
    } finally { setSaving(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Installation Tracker</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {counts.PENDING} pending · {counts.IN_PROGRESS} in progress · {counts.COMPLETED} completed
          </p>
        </div>
        {canEdit && (
          <button onClick={() => { setShowAdd(true); setAddOrderNum(''); setAddFoundOrder(null); }}
            className="btn-primary btn-sm shrink-0">+ Add Installation</button>
        )}
      </div>

      {/* Filter + Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
          {(['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === s ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {s === 'ALL' ? 'All' : STATUS_LABELS[s]}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                filter === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'
              }`}>{counts[s]}</span>
            </button>
          ))}
        </div>
        <input
          type="text" placeholder="Search customer, order, engineer…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">⚙️</div>
          <div className="font-medium">No installation records found</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm leading-5">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-3 text-left">#</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Order / PI</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Customer</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Product</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Status</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Engineer</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Install Date</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Rating</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Address</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Phone</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Notes / Feedback</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Updated</th>
                {canEdit && <th className="px-3 py-3 text-center whitespace-nowrap">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map((row, idx) => (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>

                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <button onClick={() => navigate(`${basePath}/orders/${row.production_order_id}`)}
                      className="font-mono text-blue-600 hover:underline text-xs font-semibold">{row.order_number}</button>
                    {row.pi_number && <div className="text-[10px] text-gray-400 mt-0.5">{row.pi_number}</div>}
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="font-medium text-gray-900 whitespace-nowrap">{row.customer_name}</div>
                    {row.company && <div className="text-xs text-gray-500">{row.company}</div>}
                    {row.customer_email && <div className="text-[10px] text-gray-400">{row.customer_email}</div>}
                  </td>

                  <td className="px-3 py-2.5 max-w-[150px]">
                    <div className="text-xs text-gray-700 truncate" title={row.product_interest || ''}>
                      {getProduct(row.product_interest)}
                    </div>
                  </td>

                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLES[row.status]}`}>
                      {STATUS_LABELS[row.status]}
                    </span>
                    {row.status === 'COMPLETED' && row.completed_at && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{formatDate(row.completed_at)}</div>
                    )}
                  </td>

                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-700">
                    {row.engineer_name || <span className="text-gray-300">—</span>}
                  </td>

                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-600">
                    {row.installation_date ? formatDate(row.installation_date) : <span className="text-gray-300">—</span>}
                  </td>

                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {row.rating
                      ? <StarRating value={row.rating} />
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>

                  <td className="px-3 py-2.5 max-w-[180px]">
                    <div className="text-xs text-gray-600 line-clamp-2" title={getAddress(row)}>{getAddress(row)}</div>
                  </td>

                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-600">
                    {row.customer_phone || <span className="text-gray-300">—</span>}
                  </td>

                  <td className="px-3 py-2.5 max-w-[180px]">
                    {row.feedback && (
                      <div className="text-xs text-green-700 italic truncate" title={row.feedback}>"{row.feedback}"</div>
                    )}
                    {row.support_notes && (
                      <div className="text-[10px] text-gray-500 truncate mt-0.5" title={row.support_notes}>{row.support_notes}</div>
                    )}
                    {!row.feedback && !row.support_notes && <span className="text-gray-300 text-xs">—</span>}
                  </td>

                  <td className="px-3 py-2.5 whitespace-nowrap text-[10px] text-gray-400">{formatDateTime(row.updated_at)}</td>

                  {canEdit && (
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(row)}
                          className="text-xs px-2 py-1 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium">Edit</button>
                        <button onClick={() => setDeleteTarget(row)}
                          className="text-xs px-2 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 font-medium">Delete</button>
                        <button onClick={() => navigate(`${basePath}/orders/${row.production_order_id}`)}
                          className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium">View</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Edit Modal ───────────────────────────────────────────────────── */}
      <Modal open={!!editRow} onClose={() => setEditRow(null)} title={`Edit Installation — ${editRow?.order_number}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Status</label>
              <select className="form-select" value={editForm.status}
                onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                <option value="PENDING">Pending</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
            <div>
              <label className="form-label">Installation Date</label>
              <input type="date" className="form-input" value={editForm.installation_date}
                onChange={e => setEditForm(p => ({ ...p, installation_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="form-label">Engineer Name</label>
            <input type="text" className="form-input" placeholder="Assigned technician"
              value={editForm.engineer_name}
              onChange={e => setEditForm(p => ({ ...p, engineer_name: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Support Notes</label>
            <textarea rows={2} className="form-textarea" placeholder="Installation notes or issues…"
              value={editForm.support_notes}
              onChange={e => setEditForm(p => ({ ...p, support_notes: e.target.value }))} />
          </div>
          {editForm.status === 'COMPLETED' && (
            <>
              <div>
                <label className="form-label">Customer Feedback</label>
                <textarea rows={2} className="form-textarea" placeholder="Customer remarks after installation…"
                  value={editForm.feedback}
                  onChange={e => setEditForm(p => ({ ...p, feedback: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Rating</label>
                <StarRating value={editForm.rating}
                  onChange={v => setEditForm(p => ({ ...p, rating: v }))} />
              </div>
            </>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={() => setEditRow(null)} className="btn-secondary">Cancel</button>
            <button onClick={submitEdit} disabled={saving} className="btn-primary">{saving ? '…' : 'Save Changes'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirm ───────────────────────────────────────────────── */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Installation Record?">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            This will <strong>permanently delete</strong> the installation record for{' '}
            <strong>{deleteTarget?.customer_name}</strong> ({deleteTarget?.order_number}) and revert the
            order status back to <span className="font-mono text-blue-600">DISPATCHED</span>.
          </p>
          <p className="text-xs text-red-400">This action cannot be undone.</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
            <button onClick={confirmDelete} disabled={deleting} className="btn-danger">{deleting ? '…' : 'Delete'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Add Modal ────────────────────────────────────────────────────── */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Installation Record">
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Enter the production order number for an order at the{' '}
            <span className="font-mono bg-blue-50 text-blue-700 px-1 rounded">INSTALLATION</span> stage.
          </p>
          <div className="flex gap-2">
            <input type="text" className="form-input flex-1" placeholder="e.g. LYR-2026-001"
              value={addOrderNum} onChange={e => setAddOrderNum(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchOrder()} />
            <button onClick={searchOrder} disabled={addSearching} className="btn-secondary btn-sm shrink-0">
              {addSearching ? '…' : 'Search'}
            </button>
          </div>
          {addFoundOrder && (
            <div className="border rounded-lg p-3 bg-green-50 border-green-200 text-sm space-y-1">
              <div className="font-semibold text-green-800">✅ {addFoundOrder.order_number}</div>
              <div className="text-green-700">{addFoundOrder.customer_name}</div>
              <button onClick={createInstallation} disabled={saving} className="btn-primary btn-sm mt-2">
                {saving ? '…' : 'Create Installation Record'}
              </button>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => setShowAdd(false)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
