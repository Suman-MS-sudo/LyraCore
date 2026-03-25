import { useEffect, useState } from 'react';
import api from '../../utils/api';
import { formatCurrency } from '../../utils/helpers';
import Modal from '../../components/Modal';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

interface Product {
  id: string;
  name: string;
  model_code?: string;
  product_type: string;
  description?: string;
  base_price?: number;
  hsn_sac_code?: string;
  gst_rate?: number;
  specifications?: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const EMPTY_FORM = { name: '', model_code: '', product_type: 'Vending Machine', description: '', base_price: '', hsn_sac_code: '', gst_rate: '18', specifications: '', is_active: 1 };
const TYPES = ['All', 'Vending Machine', 'Incinerator'];

export default function Products() {
  const { user } = useAuth();
  const isManagement = user?.role === 'management';

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('All');
  const [showInactive, setShowInactive] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const fetchProducts = async () => {
    setLoading(true);
    const params: any = {};
    if (!showInactive) params.active = 'true';
    if (typeFilter !== 'All') params.product_type = typeFilter;
    const res = await api.get('/products', { params });
    setProducts(res.data);
    setLoading(false);
  };

  useEffect(() => { fetchProducts(); }, [typeFilter, showInactive]);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      model_code: p.model_code || '',
      product_type: p.product_type,
      description: p.description || '',
      base_price: p.base_price !== undefined && p.base_price !== null ? String(p.base_price) : '',
      hsn_sac_code: p.hsn_sac_code || '',
      gst_rate: p.gst_rate !== undefined && p.gst_rate !== null ? String(p.gst_rate) : '18',
      specifications: p.specifications || '',
      is_active: p.is_active,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.product_type) return toast.error('Name and type required');
    setSaving(true);
    try {
      const payload = {
        ...form,
        base_price: form.base_price ? Number(form.base_price) : null,
        gst_rate: form.gst_rate ? Number(form.gst_rate) : 18,
      };
      if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
        toast.success('Product updated');
      } else {
        await api.post('/products', payload);
        toast.success('Product added');
      }
      setShowModal(false);
      fetchProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p: Product) => {
    try {
      await api.patch(`/products/${p.id}`, { is_active: p.is_active ? 0 : 1 });
      toast.success(p.is_active ? 'Product deactivated' : 'Product activated');
      fetchProducts();
    } catch { toast.error('Failed'); }
  };

  const handleDelete = async (p: Product) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/products/${p.id}`);
      toast.success('Deleted');
      fetchProducts();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Product Catalog</h1>
        {isManagement && <button onClick={openAdd} className="btn btn-primary btn-sm">+ Add Product</button>}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 transition-colors ${typeFilter === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >{t}</button>
          ))}
        </div>
        {isManagement && (
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
            Show inactive
          </label>
        )}
        <div className="text-xs text-gray-400">{products.length} products</div>
      </div>

      {/* Product grid */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading...</div>
      ) : products.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          <div className="text-4xl mb-3">📦</div>
          <div className="font-medium">No products yet</div>
          {isManagement && <div className="text-sm mt-1">Add your product models using the button above.</div>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {products.map(p => (
            <div key={p.id} className={`card p-4 flex flex-col gap-3 ${!p.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg">{p.product_type === 'Vending Machine' ? '🏪' : '🔥'}</span>
                    <span className="font-semibold text-gray-900 text-sm">{p.name}</span>
                    {!p.is_active && <span className="badge badge-red text-xs">Inactive</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="badge badge-blue text-xs">{p.product_type}</span>
                    {p.model_code && <span className="font-mono text-xs text-gray-400">{p.model_code}</span>}
                  </div>
                </div>
                {isManagement && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(p)} className="btn btn-secondary btn-xs text-xs px-2 py-1">Edit</button>
                  </div>
                )}
              </div>

              {p.base_price !== undefined && p.base_price !== null && (() => {
                const rate  = p.gst_rate !== undefined && p.gst_rate !== null ? p.gst_rate : 18;
                const gst   = Math.round(p.base_price! * rate / 100);
                const total = p.base_price! + gst;
                return (
                  <div className="space-y-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-emerald-600">{formatCurrency(total)}</span>
                      <span className="text-xs text-gray-400">incl. GST</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatCurrency(p.base_price)} + {formatCurrency(gst)} GST ({rate}%)
                    </div>
                  </div>
                );
              })()}

              {p.description && (
                <div className="text-sm text-gray-600">{p.description}</div>
              )}

              {p.specifications && (
                <div className="bg-gray-50 rounded p-2.5">
                  <div className="text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Specifications</div>
                  <div className="text-xs text-gray-700 whitespace-pre-line">{p.specifications}</div>
                </div>
              )}

              {isManagement && (
                <div className="flex gap-2 pt-1 border-t border-gray-100 mt-auto">
                  <button onClick={() => handleToggleActive(p)} className="text-xs text-gray-500 hover:text-gray-700">
                    {p.is_active ? '⏸ Deactivate' : '▶ Activate'}
                  </button>
                  <button onClick={() => handleDelete(p)} className="text-xs text-red-400 hover:text-red-600 ml-auto">
                    🗑 Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Product' : 'Add Product'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="form-label">Product Name *</label>
            <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Vending Machine Pro 500" />
          </div>
          <div>
            <label className="form-label">Product Type *</label>
            <select className="form-input" value={form.product_type} onChange={e => setForm(p => ({ ...p, product_type: e.target.value }))}>
              <option value="Vending Machine">Vending Machine</option>
              <option value="Incinerator">Incinerator</option>
            </select>
          </div>
          <div>
            <label className="form-label">Model Code</label>
            <input className="form-input" value={form.model_code} onChange={e => setForm(p => ({ ...p, model_code: e.target.value }))} placeholder="e.g. VM-500, INC-200" />
          </div>
          <div>
            <label className="form-label">Base Price (₹) <span className="text-gray-400 font-normal">(excl. GST)</span></label>
            <input type="number" className="form-input" value={form.base_price} onChange={e => setForm(p => ({ ...p, base_price: e.target.value }))} placeholder="0" />
          </div>
          <div>
            <label className="form-label">GST Rate (%)</label>
            <input type="number" min="0" max="100" step="0.1" className="form-input" value={form.gst_rate} onChange={e => setForm(p => ({ ...p, gst_rate: e.target.value }))} placeholder="e.g. 5, 12, 18, 28" />
          </div>
          <div>
            <label className="form-label">HSN/SAC Code</label>
            <input className="form-input" value={form.hsn_sac_code} onChange={e => setForm(p => ({ ...p, hsn_sac_code: e.target.value }))} placeholder="e.g. 8419, 998363" />
          </div>
          {/* GST breakdown — shown as soon as base price is entered */}
          {Number(form.base_price) > 0 && (() => {
            const base = Number(form.base_price);
            const rate = Number(form.gst_rate) || 0;
            const gst  = Math.round(base * rate / 100);
            const total = base + gst;
            return (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm">
                <div className="text-xs font-semibold text-blue-500 mb-2 uppercase tracking-wider">GST Calculation ({rate}%)</div>
                <div className="space-y-1">
                  <div className="flex justify-between text-gray-600">
                    <span>Base Price</span>
                    <span>{formatCurrency(base)}</span>
                  </div>
                  <div className="flex justify-between text-blue-600">
                    <span>GST @ {rate}%</span>
                    <span>+ {formatCurrency(gst)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-gray-900 border-t border-blue-200 pt-1 mt-1">
                    <span>Total (incl. GST)</span>
                    <span>{formatCurrency(total)}</span>
                  </div>
                </div>
              </div>
            );
          })()}
          <div className="sm:col-span-2">
            <label className="form-label">Description</label>
            <textarea className="form-input h-16" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Brief description for the sales team..." />
          </div>
          <div className="sm:col-span-2">
            <label className="form-label">Specifications <span className="text-gray-400 font-normal">(one per line)</span></label>
            <textarea className="form-input h-24 font-mono text-sm" value={form.specifications} onChange={e => setForm(p => ({ ...p, specifications: e.target.value }))} placeholder="Capacity: 500 items&#10;Dimensions: 180cm x 60cm x 80cm&#10;Power: 220V AC&#10;Temperature: 2–8°C" />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Product'}</button>
        </div>
      </Modal>
    </div>
  );
}
