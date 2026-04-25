import { useEffect, useState, useRef } from 'react';
import Modal from '../../components/Modal';
import { useSearchParams } from 'react-router-dom';
import { Search, QrCode, Printer, Plus, Minus, Hash, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { printStickerSheet } from '../../utils/printStickers';
import api from '../../utils/api';
import { InventoryComponent, ComponentStats } from '../../types';
import { decodeQRFromImage } from '../../utils/jsqr-decode';
import jsQR from 'jsqr';

type UpdateMode = 'ADD' | 'SUBTRACT' | 'SET';

type PrintBatch = {
  componentName: string;
  sku?: string | null;
  location?: string | null;
  category?: string | null;
  units: { id: string; unit_seq: number }[];
  totalUnits: number;
};

function stockColor(c: InventoryComponent) {
  if (c.quantity === 0) return 'text-red-600';
  if (c.min_quantity > 0 && c.quantity <= c.min_quantity) return 'text-amber-600';
  return 'text-emerald-600';
}

export default function InventoryUpdater() {
  const [searchParams]                = useSearchParams();
  const [components, setComponents]   = useState<InventoryComponent[]>([]);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState<InventoryComponent | null>(null);
  const [mode, setMode]               = useState<UpdateMode>('ADD');
  const [changeValue, setChangeValue] = useState('');
  const [notes, setNotes]             = useState('');
  const [saving, setSaving]           = useState(false);
  const [printBatch, setPrintBatch]   = useState<PrintBatch | null>(null);
  const [stats, setStats]             = useState<ComponentStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  useEffect(() => {
    api.get('/inventory').then(r => setComponents(r.data));
  }, []);

  // Auto-select component from ?id= query param (QR scan deep-link)
  useEffect(() => {
    const idParam = searchParams.get('id');
    if (!idParam || components.length === 0) return;
    const match = components.find(c => String(c.id) === idParam);
    if (match) selectComponent(match);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components]);

  const filtered = components.filter(c => {
    const q = search.toLowerCase();
    return !q ||
      c.name.toLowerCase().includes(q) ||
      (c.sku || '').toLowerCase().includes(q) ||
      (c.category || '').toLowerCase().includes(q);
  });

  const updatePanelRef = useRef<HTMLDivElement>(null);

  const selectComponent = (c: InventoryComponent) => {
    setSelected(c);
    setChangeValue('');
    setNotes('');
    setMode('ADD');
    setStats(null);
    setLoadingStats(true);
    api.get(`/inventory/${c.id}/stats`)
      .then(r => setStats(r.data))
      .finally(() => setLoadingStats(false));
    // On mobile the update panel is below the list — scroll it into view
    setTimeout(() => {
      updatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      inputRef.current?.focus();
    }, 80);
  };

  const preview = () => {
    if (!selected || !changeValue) return null;
    const val = Number(changeValue);
    if (isNaN(val) || val < 0) return null;
    if (mode === 'SET') return val;
    if (mode === 'ADD') return selected.quantity + val;
    return Math.max(0, selected.quantity - val);
  };

  const handleUpdate = async () => {
    if (!selected || !changeValue) return;
    const val = Number(changeValue);
    if (isNaN(val) || val < 0) return toast.error('Enter a valid positive number');
    setSaving(true);
    try {
      const change = mode === 'SUBTRACT' ? -val : val;
      const res = await api.patch(`/inventory/${selected.id}`, {
        quantity_change: change,
        update_type: mode,
        tx_notes: notes || undefined,
      });
      const data = res.data as InventoryComponent & { newUnits?: { id: string; unit_seq: number }[]; totalUnits?: number };
      setSelected(data);
      setComponents(prev => prev.map(c => c.id === data.id ? data : c));
      setChangeValue('');
      setNotes('');
      toast.success(`Updated! New stock: ${data.quantity} ${data.unit}`);
      // Refresh lifetime stats after any change
      api.get(`/inventory/${data.id}/stats`).then(r => setStats(r.data));
      if (data.newUnits && data.newUnits.length > 0) {
        setPrintBatch({ componentName: data.name, sku: data.sku, location: data.location, category: data.category, units: data.newUnits, totalUnits: data.totalUnits ?? data.newUnits.length });
      }
    } catch {
      toast.error('Failed to update inventory');
    } finally {
      setSaving(false);
    }
  };

  const previewQty = preview();

  // Scan QR handler: open modal to choose method
  const handleScanQR = () => {
    setQrModalOpen(true);
  };

  // Camera scan logic (real-time, with fallback)
  const startCameraScan = async () => {
    setQrModalOpen(false);
    setScanning(true);
    setCameraActive(true);
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      let found = false;
      while (!found && cameraActive) {
        await new Promise(r => setTimeout(r, 200));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
        let qrRaw: string | null = null;
        // Try BarcodeDetector if available
        if ('BarcodeDetector' in window) {
          try {
            // @ts-ignore
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            // @ts-ignore
            const barcodes = await detector.detect(canvas);
            if (barcodes.length > 0) {
              qrRaw = barcodes[0].rawValue;
            }
          } catch {}
        }
        // Fallback to jsQR if needed
        if (!qrRaw) {
          try {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height);
              if (code && code.data) {
                qrRaw = code.data;
              }
            }
          } catch {}
        }
        if (qrRaw) {
          found = true;
          stream.getTracks().forEach(t => t.stop());
          video.remove();
          await processQR(qrRaw);
          setScanning(false);
          setCameraActive(false);
          return;
        }
      }
      // If modal closed, stop camera
      if (!found) {
        stream.getTracks().forEach(t => t.stop());
        video.remove();
        setScanning(false);
        setCameraActive(false);
      }
    } catch (e) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (video) video.remove();
      setScanning(false);
      setCameraActive(false);
      toast.error('Camera or QR scan failed.');
    }
  };

  // Fallback: handle image upload as a real-time QR reader
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset file input so user can upload again without refresh
    e.target.value = '';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    await new Promise(r => (img.onload = r));
    let qr: string | null = null;
    // Try BarcodeDetector first
    // @ts-ignore
    if ('BarcodeDetector' in window) {
      try {
        // @ts-ignore
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(img);
        if (barcodes.length > 0) qr = barcodes[0].rawValue;
      } catch {}
    }
    // Fallback to jsQR if needed
    if (!qr) {
      qr = await decodeQRFromImage(img);
    }
    if (qr) {
      toast.success(`QR detected: ${qr}`); // Debug: show raw QR value
      await processQR(qr);
      return;
    }
    toast.error('Could not read QR code from image.');
  };

  // Parse QR and call API
  const processQR = async (raw: string) => {
    // Expect: .../inventory/use?unit=<id>
    const match = raw.match(/[?&]unit=([a-zA-Z0-9-]+)/);
    if (!match) {
      toast.error('Invalid QR code');
      return;
    }
    const unitId = match[1];
    try {
      const res = await api.post(`/inventory/use-unit/${unitId}`, {});
      toast.success('Unit taken out! Stock reduced.');
      // Optionally, refresh selected component if visible
      if (selected) {
        api.get(`/inventory/${selected.id}`).then(r => setSelected(r.data));
        api.get(`/inventory/${selected.id}/stats`).then(r => setStats(r.data));
      }
    } catch (e: any) {
      if (e?.response?.data?.error === 'already_used') {
        toast.error('This unit was already used.');
      } else if (e?.response?.data?.error === 'already_failed') {
        toast.error('This unit was marked defective.');
      } else {
        toast.error('Failed to update inventory.');
      }
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header flex items-center justify-between gap-2">
        <div>
          <h1 className="page-title">Inventory Update</h1>
          <p className="text-sm text-gray-500 mt-0.5">Select a component, update stock count — scan QR stickers on mobile to take out units</p>
        </div>
        <button
          className="btn btn-secondary flex items-center gap-2"
          onClick={handleScanQR}
          disabled={scanning}
        >
          <QrCode size={18} />
          {scanning ? 'Scanning…' : 'Scan QR'}
        </button>
        <Modal open={qrModalOpen} onClose={() => { setQrModalOpen(false); setCameraActive(false); }} title="Scan QR Code">
          <div className="flex flex-col gap-4">
            <button
              className="btn btn-primary"
              onClick={startCameraScan}
              disabled={scanning}
            >
              <QrCode size={18} /> Use Camera
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { setQrModalOpen(false); fileInputRef.current?.click(); }}
              disabled={scanning}
            >
              Upload QR Image
            </button>
          </div>
        </Modal>
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Left: Component selector ── */}
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-gray-800">Select Component</h2>
            <span className="text-xs text-gray-400">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="card-body">
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                placeholder="Search by name, SKU or category…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
              {filtered.length === 0 && (
                <div className="text-gray-400 text-sm text-center py-10">No components match your search</div>
              )}
              {filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => selectComponent(c)}
                  className={`w-full text-left flex items-center justify-between p-3 rounded-xl border transition-all ${
                    selected?.id === c.id
                      ? 'border-blue-500 bg-blue-50 shadow-sm'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-800 truncate">{c.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {c.category && <span className="text-xs text-gray-400">{c.category}</span>}
                      {c.sku && <span className="text-xs text-gray-400 font-mono">#{c.sku}</span>}
                    </div>
                  </div>
                  <div className="text-right ml-3 shrink-0">
                    <div className={`text-base font-bold ${stockColor(c)}`}>{c.quantity}</div>
                    <div className="text-xs text-gray-400">{c.unit}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Update panel + QR ── */}
        <div className="space-y-4" ref={updatePanelRef}>
          {selected ? (
            <>
              {/* Component summary */}
              <div className="card">
                <div className="card-header">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-gray-800 truncate">{selected.name}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      {selected.sku && <span className="text-xs text-gray-400 font-mono">#{selected.sku}</span>}
                      {selected.category && <span className="text-xs text-gray-400">{selected.category}</span>}
                      {selected.location && <span className="text-xs text-gray-400">📍 {selected.location}</span>}
                    </div>
                  </div>
                </div>
                <div className="card-body space-y-4">
                  {/* Current stock display */}
                  <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
                    <span className="text-sm text-gray-500">Current Stock</span>
                    <div className="text-right">
                      <span className={`text-2xl font-bold ${stockColor(selected)}`}>{selected.quantity}</span>
                      <span className="text-sm text-gray-400 ml-1">{selected.unit}</span>
                      {selected.min_quantity > 0 && (
                        <div className="text-xs text-gray-400">min: {selected.min_quantity}</div>
                      )}
                    </div>
                  </div>

                  {/* Mode selector */}
                  <div className="flex gap-2">
                    {(['ADD', 'SUBTRACT', 'SET'] as UpdateMode[]).map(m => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl border transition-all ${
                          mode === m
                            ? m === 'ADD' ? 'bg-emerald-600 text-white border-emerald-600'
                            : m === 'SUBTRACT' ? 'bg-red-600 text-white border-red-600'
                            : 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {m === 'ADD' && <Plus size={12} />}
                        {m === 'SUBTRACT' && <Minus size={12} />}
                        {m === 'SET' && <Hash size={12} />}
                        {m}
                      </button>
                    ))}
                  </div>

                  {/* Quantity input */}
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="number"
                      min="0"
                      className="input flex-1"
                      placeholder={mode === 'SET' ? 'Set exact count' : 'Enter quantity'}
                      value={changeValue}
                      onChange={e => setChangeValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUpdate()}
                    />
                    <button
                      onClick={handleUpdate}
                      disabled={saving || !changeValue}
                      className={`px-4 py-2 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-50 ${
                        mode === 'ADD' ? 'bg-emerald-600 hover:bg-emerald-700' :
                        mode === 'SUBTRACT' ? 'bg-red-600 hover:bg-red-700' :
                        'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {saving ? <RefreshCw size={15} className="animate-spin" /> : 'Update'}
                    </button>
                  </div>

                  {/* Preview */}
                  {previewQty !== null && (
                    <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                      After update: <span className="font-bold text-gray-800">{previewQty} {selected.unit}</span>
                    </div>
                  )}

                  <input
                    className="input"
                    placeholder="Notes (optional)"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* Print stickers banner — appears after stock is added */}
              {printBatch && (
                <div className="card bg-purple-50 border-purple-200">
                  <div className="card-body space-y-3">
                    <div className="flex items-start gap-3">
                      <QrCode size={20} className="text-purple-600 mt-0.5 shrink-0" />
                      <div>
                        <div className="font-semibold text-sm text-purple-800">
                          {printBatch.units.length} new QR sticker{printBatch.units.length !== 1 ? 's' : ''} generated
                        </div>
                        <p className="text-xs text-purple-600 mt-0.5">Print and stick one on each physical unit</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="flex-1 text-xs text-purple-500 hover:text-purple-700 py-2 border border-purple-200 rounded-xl bg-white"
                        onClick={() => setPrintBatch(null)}
                      >Dismiss</button>
                      <button
                        onClick={() => printStickerSheet(printBatch.units, printBatch.totalUnits, printBatch.componentName, printBatch.sku, printBatch.location, printBatch.category, window.location.origin)}
                        className="flex-1 btn-primary btn-sm flex items-center justify-center gap-1.5"
                      >
                        <Printer size={13} /> Print {printBatch.units.length} Sticker{printBatch.units.length !== 1 ? 's' : ''}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Lifetime stats + purchase history */}
              {(loadingStats || stats) && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="font-semibold text-gray-700 text-sm">Purchase History</h3>
                    {loadingStats && <span className="text-xs text-gray-400">Loading…</span>}
                  </div>
                  {stats && (
                    <div className="card-body space-y-3">
                      {/* Four stat boxes */}
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: 'Total Bought', value: stats.total_bought, cls: 'bg-blue-50 text-blue-700' },
                          { label: 'In Stock',     value: stats.in_stock,     cls: 'bg-emerald-50 text-emerald-700' },
                          { label: 'Used',         value: stats.used_count,   cls: 'bg-gray-50 text-gray-700' },
                          { label: 'Failed',       value: stats.failed_count, cls: 'bg-red-50 text-red-700' },
                        ].map(s => (
                          <div key={s.label} className={`rounded-xl p-2 text-center ${s.cls}`}>
                            <div className="text-xl font-bold leading-none">{s.value}</div>
                            <div className="text-xs mt-1 opacity-70 leading-tight">{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Per-purchase rows */}
                      {stats.purchase_history.length > 0 ? (
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Purchases</div>
                          {stats.purchase_history.map(tx => (
                            <div key={tx.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                              <div>
                                <span className="font-medium text-gray-700">+{tx.quantity_change} pcs</span>
                                {tx.notes && <span className="text-gray-400 ml-2 text-xs">{tx.notes}</span>}
                              </div>
                              <span className="text-xs text-gray-400">{tx.created_at.slice(0, 10)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 text-center py-1">No purchase records yet</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="card">
              <div className="card-body flex flex-col items-center justify-center py-20 text-gray-400">
                <QrCode size={44} className="mb-3 opacity-20" />
                <p className="text-sm font-medium">Select a component on the left</p>
                <p className="text-xs mt-1">to update stock counts</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
