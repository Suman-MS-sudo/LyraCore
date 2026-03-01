import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import INDIA_CITIES from '../../data/indiaCities';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { LEAD_SOURCES, formatCurrency } from '../../utils/helpers';
import { User } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

interface Product {
  id: string;
  name: string;
  model_code?: string;
  product_type: string;
  base_price?: number;
  is_active: number;
}

interface SelectedItem {
  product: Product;
  qty: number;
}

const SOURCE_LABELS: Record<string, string> = {
  referral: 'Reference / Referral', website: 'Website', cold_call: 'Cold Call',
  exhibition: 'Exhibition / Event', social_media: 'Social Media', other: 'Other',
};

const GST_RATE = 0.18;

export default function NewLead() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const basePath = location.pathname.startsWith('/management') ? '/management' : '/sales';

  const [salesUsers, setSalesUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [pickProduct, setPickProduct] = useState('');
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_email: '', company: '',
    source: 'referral', notes: '', assigned_to: '',
    location: '', address: '', delivery_address: '', purchase_timeline: '', budget_range: '',
    customization_notes: '', requirement_type: 'standard',
    // manual fallback when no catalog products
    product_interest: '', product_type: '',
  });
  const [saving, setSaving] = useState(false);
  const [locState, setLocState] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [showCityDrop, setShowCityDrop] = useState(false);
  const cityRef = useRef<HTMLDivElement>(null);

  // close city dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (cityRef.current && !cityRef.current.contains(e.target as Node)) setShowCityDrop(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    api.get('/auth/users').then(r => setSalesUsers(r.data.filter((u: User) => u.role === 'sales')));
    api.get('/products', { params: { active: 'true' } }).then(r => setProducts(r.data));
  }, []);

  const productTypes = [...new Set(products.map(p => p.product_type))];

  /* ── cart helpers ── */
  const addProduct = () => {
    if (!pickProduct) return;
    const product = products.find(p => p.id === pickProduct);
    if (!product) return;
    setSelectedItems(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product, qty: 1 }];
    });
    setPickProduct('');
  };

  const removeItem = (productId: string) =>
    setSelectedItems(prev => prev.filter(i => i.product.id !== productId));

  const updateQty = (productId: string, qty: number) => {
    if (qty < 1) return removeItem(productId);
    setSelectedItems(prev => prev.map(i => i.product.id === productId ? { ...i, qty } : i));
  };

  /* ── calculated totals ── */
  const subtotal   = selectedItems.reduce((s, i) => s + (i.product.base_price || 0) * i.qty, 0);
  const gstAmount  = Math.round(subtotal * GST_RATE);
  const grandTotal = subtotal + gstAmount;
  const totalQty   = selectedItems.reduce((s, i) => s + i.qty, 0);

  /* ── derived payload fields ── */
  const buildPayload = () => {
    if (selectedItems.length > 0) {
      const lines = selectedItems.map(i =>
        `${i.qty}x ${i.product.name}${i.product.model_code ? ` (${i.product.model_code})` : ''}`
      );
      return {
        product_interest: lines.join(', '),
        product_type: [...new Set(selectedItems.map(i => i.product.product_type))].join(', '),
        quantity: String(totalQty),
        estimated_value: grandTotal > 0 ? grandTotal : undefined,
      };
    }
    return {
      product_interest: form.product_interest,
      product_type: form.product_type,
      quantity: '',
      estimated_value: undefined,
    };
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const derived = buildPayload();
    if (!form.customer_name || !form.customer_phone || !derived.product_interest)
      return toast.error('Fill all required fields and add at least one product');
    setSaving(true);
    try {
      const payload: any = { ...form, ...derived };
      if (!payload.assigned_to) delete payload.assigned_to;
      if (!payload.estimated_value) delete payload.estimated_value;
      const res = await api.post('/leads', payload);
      toast.success(`Lead ${res.data.lead_number} created! Contact within 5 minutes.`);
      navigate(`${basePath}/leads/${res.data.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate(`${basePath}/leads`)} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
        <h1 className="text-xl font-bold text-gray-900">New Lead</h1>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <span className="text-lg shrink-0">⚡</span>
        <div className="text-sm text-amber-800">
          <strong>SOP Rule:</strong> Contact the customer within <strong>5 minutes</strong> of receiving this lead.
          Call first — if no answer, send WhatsApp, then email.
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Customer Info ── */}
        <div className="card p-5 space-y-4">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Step 1 — Customer Information</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Customer Name *</label>
              <input className="form-input" value={form.customer_name} onChange={set('customer_name')} required placeholder="Full name" />
            </div>
            <div>
              <label className="form-label">Phone Number *</label>
              <input className="form-input" value={form.customer_phone} onChange={set('customer_phone')} required placeholder="+91 9999999999" />
            </div>
            <div>
              <label className="form-label">Email ID</label>
              <input type="email" className="form-input" value={form.customer_email} onChange={set('customer_email')} placeholder="optional" />
            </div>
            <div>
              <label className="form-label">Company / Organisation</label>
              <input className="form-input" value={form.company} onChange={set('company')} placeholder="optional" />
            </div>
            <div>
              <label className="form-label">Lead Source *</label>
              <select className="form-input" value={form.source} onChange={set('source')}>
                {LEAD_SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABELS[s] || s}</option>)}
              </select>
            </div>
            {user?.role === 'management' && salesUsers.length > 0 && (
              <div>
                <label className="form-label">Assign To</label>
                <select className="form-input" value={form.assigned_to} onChange={set('assigned_to')}>
                  <option value="">Self</option>
                  {salesUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* ── Products ── */}
        <div className="card p-5 space-y-4">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Step 2 — Products Required (SOP Step 3–4)</div>

          {products.length > 0 ? (
            <>
              {/* Picker row */}
              <div className="flex gap-2">
                <select
                  className="form-input flex-1"
                  value={pickProduct}
                  onChange={e => setPickProduct(e.target.value)}
                >
                  <option value="">— Select a product to add —</option>
                  {productTypes.map(type => (
                    <optgroup key={type} label={type}>
                      {products.filter(p => p.product_type === type).map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.model_code ? ` — ${p.model_code}` : ''}
                          {p.base_price ? ` (${formatCurrency(p.base_price)})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button type="button" onClick={addProduct} disabled={!pickProduct} className="btn btn-primary px-4 shrink-0">
                  + Add
                </button>
              </div>

              {/* Selected items table */}
              {selectedItems.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Product</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500 w-28">Qty</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Unit Price</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Amount</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedItems.map(({ product, qty }) => {
                        const lineBase = (product.base_price || 0) * qty;
                        return (
                          <tr key={product.id} className="bg-white">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-800">{product.name}</div>
                              {product.model_code && <div className="text-xs text-gray-400 font-mono">{product.model_code}</div>}
                              <div className="text-xs text-gray-400">{product.product_type}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-1">
                                <button type="button" onClick={() => updateQty(product.id, qty - 1)}
                                  className="w-6 h-6 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-sm font-bold">−</button>
                                <input
                                  type="number" min={1}
                                  className="w-12 text-center border border-gray-300 rounded px-1 py-0.5 text-sm"
                                  value={qty}
                                  onChange={e => updateQty(product.id, parseInt(e.target.value) || 1)}
                                />
                                <button type="button" onClick={() => updateQty(product.id, qty + 1)}
                                  className="w-6 h-6 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-sm font-bold">+</button>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-600">
                              {product.base_price ? formatCurrency(product.base_price) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-gray-800">
                              {product.base_price ? formatCurrency(lineBase) : '—'}
                            </td>
                            <td className="px-2 py-2">
                              <button type="button" onClick={() => removeItem(product.id)}
                                className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {subtotal > 0 && (
                      <tfoot className="bg-gray-50 border-t border-gray-200">
                        <tr>
                          <td colSpan={3} className="px-3 py-1.5 text-xs text-right text-gray-500">Subtotal ({totalQty} unit{totalQty !== 1 ? 's' : ''})</td>
                          <td className="px-3 py-1.5 text-right text-sm font-semibold text-gray-700">{formatCurrency(subtotal)}</td>
                          <td></td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="px-3 py-1 text-xs text-right text-blue-500">GST @ 18%</td>
                          <td className="px-3 py-1 text-right text-sm text-blue-600">+ {formatCurrency(gstAmount)}</td>
                          <td></td>
                        </tr>
                        <tr className="border-t border-gray-300">
                          <td colSpan={3} className="px-3 py-2 text-xs text-right font-bold text-gray-700">Total (incl. GST)</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-600 text-base">{formatCurrency(grandTotal)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {selectedItems.length === 0 && (
                <div className="text-sm text-gray-400 text-center py-4 border-2 border-dashed border-gray-200 rounded-lg">
                  No products added yet — select from the dropdown above
                </div>
              )}
            </>
          ) : (
            /* Fallback when catalog is empty */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Product Type</label>
                <input className="form-input" value={form.product_type} onChange={set('product_type')} placeholder="e.g. Vending Machine" />
              </div>
              <div>
                <label className="form-label">Product / Service Details *</label>
                <input className="form-input" value={form.product_interest} onChange={set('product_interest')} placeholder="Model, spec, size…" />
              </div>
            </div>
          )}

          {/* Requirement details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
            <div className="sm:col-span-2">
              <label className="form-label">Installation Location</label>
              <div className="flex gap-2 items-start">
                {/* State picker */}
                <select
                  className="form-input w-48 flex-shrink-0"
                  value={locState}
                  onChange={e => {
                    setLocState(e.target.value);
                    setCitySearch('');
                    setForm(p => ({ ...p, location: '' }));
                  }}
                >
                  <option value="">— State —</option>
                  {Object.keys(INDIA_CITIES).map(s => <option key={s}>{s}</option>)}
                </select>

                {/* Searchable city picker */}
                {locState && (
                  <div ref={cityRef} className="relative flex-1">
                    <input
                      type="text"
                      className="form-input w-full"
                      placeholder="Search city…"
                      value={citySearch || (form.location ? form.location.split(',')[0] : '')}
                      onFocus={() => { setCitySearch(''); setShowCityDrop(true); }}
                      onChange={e => { setCitySearch(e.target.value); setShowCityDrop(true); }}
                    />
                    {showCityDrop && (
                      <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                        {(INDIA_CITIES[locState] ?? [])
                          .filter(c => !citySearch || c.toLowerCase().includes(citySearch.toLowerCase()))
                          .map(c => (
                            <button
                              key={c}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                              onMouseDown={() => {
                                setForm(p => ({ ...p, location: `${c}, ${locState}` }));
                                setCitySearch('');
                                setShowCityDrop(false);
                              }}
                            >
                              {c}
                            </button>
                          ))
                        }
                        {(INDIA_CITIES[locState] ?? []).filter(c =>
                          !citySearch || c.toLowerCase().includes(citySearch.toLowerCase())
                        ).length === 0 && (
                          <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {form.location && (
                <p className="mt-1 text-xs text-gray-500">✓ {form.location}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Installation Address</label>
              <textarea
                className="form-input resize-none"
                rows={2}
                placeholder="Door no., Street, Area, Landmark…"
                value={form.address}
                onChange={set('address')}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Delivery / Shipping Address <span className="text-gray-400 font-normal">(if different from above)</span></label>
              <textarea
                className="form-input resize-none"
                rows={2}
                placeholder="Leave blank if same as installation address…"
                value={form.delivery_address}
                onChange={set('delivery_address')}
              />
            </div>
            <div>
              <label className="form-label">Purchase Timeline</label>
              <input
                type="date"
                className="form-input"
                value={
                  form.purchase_timeline
                    ? (() => { try { const d = new Date(form.purchase_timeline); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); } catch { return ''; } })()
                    : ''
                }
                onChange={e => {
                  if (!e.target.value) { setForm(p => ({ ...p, purchase_timeline: '' })); return; }
                  const d = new Date(e.target.value);
                  setForm(p => ({ ...p, purchase_timeline: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }));
                }}
              />
            </div>
            <div>
              <label className="form-label">Budget Range</label>
              <select className="form-input" value={form.budget_range} onChange={set('budget_range')}>
                <option value="">— Select Range —</option>
                <option>₹15,000 – ₹30,000</option>
                <option>₹30,000 – ₹50,000</option>
                <option>₹50,000 – ₹1 Lakh</option>
                <option>₹1L – ₹2L</option>
                <option>₹2L – ₹5L</option>
                <option>₹5L – ₹10L</option>
                <option>₹10L – ₹25L</option>
                <option>₹25L – ₹50L</option>
                <option>₹50L – ₹1 Crore</option>
                <option>Above ₹1 Crore</option>
              </select>
            </div>
            <div>
              <label className="form-label">Solution Type</label>
              <select className="form-input" value={form.requirement_type} onChange={set('requirement_type')}>
                <option value="standard">Standard Model</option>
                <option value="custom">Customised Solution</option>
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Customisation Requirements</label>
            <textarea className="form-input h-16" value={form.customization_notes} onChange={set('customization_notes')} placeholder="Special customisation, branding, size, features…" />
          </div>
          <div>
            <label className="form-label">Notes / Initial Context</label>
            <textarea className="form-input h-16" value={form.notes} onChange={set('notes')} placeholder="How did they hear about us? What did they say?…" />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => navigate(`${basePath}/leads`)} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary px-6">{saving ? 'Creating…' : '+ Create Lead'}</button>
        </div>
      </form>
    </div>
  );
}
