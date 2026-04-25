import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, QrCode, Printer, AlertTriangle, Package, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { formatDate } from '../../utils/helpers';
import Modal from '../../components/Modal';
import { printStickerSheet } from '../../utils/printStickers';
import { InventoryComponent, InventoryTransaction } from '../../types';

interface DashboardStats {
  total: number;
  lowStock: number;
  outOfStock: number;
  categories: { category: string; count: number; total_qty: number }[];
  recentTransactions: (InventoryTransaction & { component_name: string })[];
  alertItems: InventoryComponent[];
}

const UNITS = ['pcs', 'nos', 'kg', 'g', 'ltr', 'ml', 'm', 'cm', 'mm', 'set', 'pair', 'roll', 'sheet', 'box', 'pack'];

function stockBadge(c: InventoryComponent) {
  if (c.quantity === 0) return 'bg-red-100 text-red-700';
  if (c.min_quantity > 0 && c.quantity <= c.min_quantity) return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

type PrintBatch = {
  componentName: string;
  sku?: string | null;
  location?: string | null;
  category?: string | null;
  units: { id: string; unit_seq: number }[];
  totalUnits: number;
};

const emptyForm = {
  name: '', category: '', sku: '', description: '',
  unit: 'pcs', quantity: '', min_quantity: '', location: '', supplier: '', notes: '',
};

export default function InventoryDashboard() {
  const [stats, setStats]         = useState<DashboardStats | null>(null);
  const [components, setComponents] = useState<InventoryComponent[]>([]);
  const [search, setSearch]       = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState<'add' | 'edit' | null>(null);
  const [selected, setSelected]   = useState<InventoryComponent | null>(null);
  const [form, setForm]           = useState({ ...emptyForm });
  const [saving, setSaving]       = useState(false);
  const [printBatch, setPrintBatch] = useState<PrintBatch | null>(null);
  const [txModal, setTxModal]     = useState<InventoryComponent | null>(null);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);

  const fetchAll = async () => {
    const [s, c] = await Promise.all([
      api.get('/inventory/dashboard-stats'),
      api.get('/inventory'),
    ]);
    setStats(s.data);
    setComponents(c.data);
  };

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, []);

  const filtered = components.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q) || (c.sku || '').toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q);
    const matchCat = !catFilter || c.category === catFilter;
    return matchSearch && matchCat;
  });

  const categories = Array.from(new Set(components.map(c => c.category).filter(Boolean))) as string[];

  const openAdd = () => { setForm({ ...emptyForm }); setSelected(null); setModal('add'); };
  const openEdit = (c: InventoryComponent) => {
    setSelected(c);
    setForm({
      name: c.name, category: c.category || '', sku: c.sku || '',
      description: c.description || '', unit: c.unit,
      quantity: String(c.quantity), min_quantity: String(c.min_quantity),
      location: c.location || '', supplier: c.supplier || '', notes: c.notes || '',
    });
    setModal('edit');
  };

  const openQr = async (c: InventoryComponent) => {
    try {
      const [unitsRes, statsRes] = await Promise.all([
        api.get(`/inventory/${c.id}/units?status=available`),
        api.get(`/inventory/${c.id}/stats`),
      ]);
      const units: { id: string; unit_seq: number }[] = unitsRes.data.map((u: any) => ({ id: u.id, unit_seq: u.unit_seq }));
      if (units.length === 0) {
        toast('No unscanned stickers for this component.\nAll units already taken out.', { duration: 4000 });
        return;
      }
      const totalUnits: number = statsRes.data.total_bought;
      setPrintBatch({ componentName: c.name, sku: c.sku, location: c.location, category: c.category, units, totalUnits });
    } catch {
      toast.error('Failed to load units');
    }
  };

  const openTx = async (c: InventoryComponent) => {
    setTxModal(c);
    const res = await api.get(`/inventory/${c.id}/transactions`);
    setTransactions(res.data);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    setSaving(true);
    try {
      const payload = {
        ...form,
        quantity: Number(form.quantity) || 0,
        min_quantity: Number(form.min_quantity) || 0,
      };
      if (modal === 'add') {
        const res = await api.post('/inventory', payload);
        toast.success('Component added');
        const data = res.data;
        if (data.units?.length > 0) {
          setPrintBatch({ componentName: data.name, sku: data.sku, location: data.location, category: data.category, units: data.units, totalUnits: data.totalUnits ?? data.units.length });
        }
      } else if (modal === 'edit' && selected) {
        await api.patch(`/inventory/${selected.id}`, payload);
        toast.success('Component updated');
      }
      setModal(null);
      await fetchAll();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: InventoryComponent) => {
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/inventory/${c.id}`);
      toast.success('Deleted');
      await fetchAll();
    } catch {
      toast.error('Failed to delete');
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory Manager</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage components, stock levels, and print QR stickers</p>
        </div>
        <button onClick={openAdd} className="btn-primary btn-sm md:btn">
          <Plus size={15} /> <span className="hidden sm:inline">Add Component</span><span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-3.5 bg-blue-50 border-0">
            <div className="text-2xl font-bold text-blue-700">{stats.total}</div>
            <div className="text-xs text-gray-500 mt-0.5">Total Components</div>
          </div>
          <div className="card p-3.5 bg-amber-50 border-0">
            <div className="text-2xl font-bold text-amber-600">{stats.lowStock}</div>
            <div className="text-xs text-gray-500 mt-0.5">Low Stock</div>
          </div>
          <div className="card p-3.5 bg-red-50 border-0">
            <div className="text-2xl font-bold text-red-600">{stats.outOfStock}</div>
            <div className="text-xs text-gray-500 mt-0.5">Out of Stock</div>
          </div>
          <div className="card p-3.5 bg-emerald-50 border-0">
            <div className="text-2xl font-bold text-emerald-700">{stats.categories.length}</div>
            <div className="text-xs text-gray-500 mt-0.5">Categories</div>
          </div>
        </div>
      )}

      {/* Alerts */}
      {stats && stats.alertItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <span className="font-semibold text-amber-800">Stock Alerts ({stats.alertItems.length})</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {stats.alertItems.map(c => (
              <div key={c.id} className="bg-white border border-amber-200 rounded p-2 text-xs">
                <div className="font-medium text-gray-800 truncate">{c.name}</div>
                <div className={`font-bold mt-0.5 ${c.quantity === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                  {c.quantity === 0 ? '⚠ Out of stock' : `⚠ ${c.quantity} ${c.unit} left`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Components table */}
        <div className="xl:col-span-2 card">
          <div className="card-header flex-wrap gap-2">
            <h2 className="font-semibold text-gray-800">Components</h2>
            <div className="flex items-center gap-2 ml-auto">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-8 py-1.5 text-sm w-40"
                  placeholder="Search..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select
                className="input py-1.5 text-sm"
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Name / SKU</th>
                  <th className="table-th">Category</th>
                  <th className="table-th text-right">Stock</th>
                  <th className="table-th text-right">Min</th>
                  <th className="table-th">Location</th>
                  <th className="table-th text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="table-td text-center text-gray-400 py-8">No components found</td></tr>
                )}
                {filtered.map(c => (
                  <tr key={c.id} className="table-tr">
                    <td className="table-td">
                      <div className="font-medium text-sm text-gray-800">{c.name}</div>
                      {c.sku && <div className="text-xs text-gray-400 font-mono">#{c.sku}</div>}
                    </td>
                    <td className="table-td text-xs text-gray-500">{c.category || '—'}</td>
                    <td className="table-td text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${stockBadge(c)}`}>
                        {c.quantity} {c.unit}
                      </span>
                    </td>
                    <td className="table-td text-right text-xs text-gray-500">{c.min_quantity}</td>
                    <td className="table-td text-xs text-gray-500 max-w-[100px] truncate">{c.location || '—'}</td>
                    <td className="table-td">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openTx(c)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="History"
                        ><Package size={14} /></button>
                        <button
                          onClick={() => openQr(c)}
                          className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded" title="QR Sticker"
                        ><QrCode size={14} /></button>
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded" title="Edit"
                        ><Pencil size={14} /></button>
                        <button
                          onClick={() => handleDelete(c)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete"
                        ><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Category breakdown + recent transactions */}
        <div className="space-y-4">
          {stats && stats.categories.length > 0 && (
            <div className="card">
              <div className="card-header"><h2 className="font-semibold text-gray-800">By Category</h2></div>
              <div className="card-body space-y-2">
                {stats.categories.map(cat => (
                  <div key={cat.category} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate flex-1">{cat.category}</span>
                    <span className="text-gray-400 text-xs mr-3">{cat.count} items</span>
                    <span className="font-semibold text-gray-800 w-8 text-right">{cat.total_qty}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats && stats.recentTransactions.length > 0 && (
            <div className="card">
              <div className="card-header"><h2 className="font-semibold text-gray-800">Recent Activity</h2></div>
              <div className="card-body space-y-2 max-h-72 overflow-y-auto">
                {stats.recentTransactions.map(tx => (
                  <div key={tx.id} className="flex items-start gap-2 text-xs border-b border-gray-50 pb-1.5 last:border-0">
                    <span className={`mt-0.5 w-14 text-center flex-shrink-0 px-1 py-0.5 rounded font-semibold ${
                      tx.type === 'ADD' || tx.type === 'INITIAL' ? 'bg-emerald-100 text-emerald-700' :
                      tx.type === 'QR_SCAN' || tx.type === 'SUBTRACT' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                    }`}>{tx.type === 'QR_SCAN' ? 'SCAN' : tx.type}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-700 truncate">{tx.component_name}</div>
                      <div className="text-gray-400">
                        {tx.quantity_before} → {tx.quantity_after} {tx.unit} · {tx.user_name}
                      </div>
                    </div>
                    <div className="text-gray-300 shrink-0">{formatDate(tx.created_at)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      <Modal
        open={modal === 'add' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add Component' : 'Edit Component'}
        size="lg"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Name *</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Component name" />
          </div>
          <div>
            <label className="label">SKU / Part No.</label>
            <input className="input" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="e.g. CAP-100UF-50V" />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} list="cat-list" placeholder="e.g. Capacitors" />
            <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className="label">Unit</label>
            <select className="input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{modal === 'add' ? 'Initial Quantity' : 'Current Quantity (read-only)'}</label>
            <input
              className="input"
              type="number" min="0"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              readOnly={modal === 'edit'}
              disabled={modal === 'edit'}
              placeholder="0"
            />
            {modal === 'edit' && <p className="text-xs text-gray-400 mt-1">Use Inventory Updater to change stock count.</p>}
          </div>
          <div>
            <label className="label">Min. Stock (alert threshold)</label>
            <input className="input" type="number" min="0" value={form.min_quantity} onChange={e => setForm(f => ({ ...f, min_quantity: e.target.value }))} placeholder="0" />
          </div>
          <div>
            <label className="label">Location / Bin</label>
            <input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Shelf A-3" />
          </div>
          <div>
            <label className="label">Supplier</label>
            <input className="input" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier name" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : modal === 'add' ? 'Add Component' : 'Save Changes'}
          </button>
        </div>
      </Modal>

      {/* Print Stickers Modal */}
      {printBatch && (
        <Modal open onClose={() => setPrintBatch(null)} title={`QR Stickers — ${printBatch.componentName}`} size="sm">
          <div className="space-y-4">
            <div className="bg-purple-50 rounded-xl p-4 text-center">
              <div className="text-4xl font-bold text-purple-700">{printBatch.units.length}</div>
              <div className="text-sm text-purple-600 mt-1">
                sticker{printBatch.units.length !== 1 ? 's' : ''} ready to print
              </div>
            </div>
            <div className="text-sm text-gray-600 space-y-1">
              <div><span className="text-gray-400">Component: </span><span className="font-medium">{printBatch.componentName}</span></div>
              {printBatch.sku && <div><span className="text-gray-400">SKU: </span><span className="font-mono">{printBatch.sku}</span></div>}
              {printBatch.location && <div><span className="text-gray-400">Location: </span>{printBatch.location}</div>}
            </div>
            <p className="text-xs text-gray-400">Each sticker = 1 physical unit. Scan on mobile to automatically deduct 1 from stock.</p>
            <div className="flex gap-2 pt-1">
              <button className="btn-secondary flex-1" onClick={() => setPrintBatch(null)}>Later</button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={() => printStickerSheet(printBatch.units, printBatch.totalUnits, printBatch.componentName, printBatch.sku, printBatch.location, printBatch.category, window.location.origin)}
              >
                <Printer size={15} /> Print All Stickers
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Transactions History Modal */}
      <Modal open={!!txModal} onClose={() => setTxModal(null)} title={`History — ${txModal?.name || ''}`} size="lg">
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {transactions.length === 0 && (
            <div className="text-center text-gray-400 py-8">No transactions yet</div>
          )}
          {transactions.map(tx => (
            <div key={tx.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 text-sm">
              <span className={`px-2 py-0.5 rounded text-xs font-bold shrink-0 ${
                tx.type === 'ADD' || tx.type === 'INITIAL' ? 'bg-emerald-100 text-emerald-700' :
                tx.type === 'QR_SCAN' || tx.type === 'SUBTRACT' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
              }`}>{tx.type === 'QR_SCAN' ? 'SCAN' : tx.type}</span>
              <div className="flex-1 min-w-0">
                <span className="font-medium">{tx.quantity_before} → {tx.quantity_after}</span>
                <span className="text-gray-400 text-xs ml-2">(Δ {tx.quantity_change > 0 ? '+' : ''}{tx.quantity_change})</span>
                {tx.notes && <div className="text-xs text-gray-500 truncate">{tx.notes}</div>}
              </div>
              <div className="text-right text-xs text-gray-400 shrink-0">
                <div>{tx.user_name}</div>
                <div>{formatDate(tx.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
