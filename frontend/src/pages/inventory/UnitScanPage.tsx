import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Package, Loader2, AlertCircle, QrCode, XCircle } from 'lucide-react';
import api from '../../utils/api';
import { InventoryUnit } from '../../types';

type PageState = 'loading' | 'ready' | 'used' | 'defective' | 'done' | 'failed_done' | 'error';

interface UseResult {
  success: boolean;
  componentName: string;
  unit: string;
  remainingStock: number;
}

interface FailResult {
  success: boolean;
  componentName: string;
  remainingStock: number;
}

export default function UnitScanPage() {
  const [searchParams] = useSearchParams();
  const unitId = searchParams.get('unit');

  const [unitInfo, setUnitInfo]     = useState<InventoryUnit | null>(null);
  const [state, setState]           = useState<PageState>('loading');
  const [confirming, setConfirming] = useState(false);
  const [failing, setFailing]       = useState(false);
  const [result, setResult]         = useState<UseResult | null>(null);
  const [failResult, setFailResult] = useState<FailResult | null>(null);
  const [errorMsg, setErrorMsg]     = useState('');

  useEffect(() => {
    if (!unitId) {
      setErrorMsg('Invalid QR code — no unit ID found.');
      setState('error');
      return;
    }
    api.get(`/inventory/unit/${unitId}`)
      .then((r) => {
        setUnitInfo(r.data);
        if (r.data.status === 'used') setState('used');
        else if (r.data.status === 'failed') setState('defective');
        else setState('ready');
      })
      .catch(() => {
        setErrorMsg('Unit not found. This QR sticker may be invalid or expired.');
        setState('error');
      });
  }, [unitId]);

  const handleConfirm = async () => {
    if (!unitId) return;
    setConfirming(true);
    try {
      const res = await api.post(`/inventory/use-unit/${unitId}`, {});
      setResult(res.data);
      setState('done');
    } catch (e: any) {
      if (e?.response?.status === 409) {
        const err = e.response.data.error;
        if (err === 'already_failed') {
          setState('defective');
        } else {
          setUnitInfo((prev) =>
            prev
              ? { ...prev, status: 'used', used_at: e.response.data.usedAt, used_by_name: e.response.data.usedBy }
              : prev,
          );
          setState('used');
        }
      } else {
        setErrorMsg('Failed to process. Please try again.');
        setState('error');
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleFail = async () => {
    if (!unitId) return;
    if (!window.confirm('Mark this unit as defective? It will be removed from available stock.')) return;
    setFailing(true);
    try {
      const res = await api.post(`/inventory/fail-unit/${unitId}`, {});
      setFailResult(res.data);
      setState('failed_done');
    } catch (e: any) {
      if (e?.response?.status === 409) {
        setState('defective');
      } else {
        setErrorMsg('Failed to mark unit. Please try again.');
        setState('error');
      }
    } finally {
      setFailing(false);
    }
  };

  /* ── Loading ── */
  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 size={40} className="animate-spin text-blue-500" />
        <p className="text-gray-500 text-sm">Loading unit…</p>
      </div>
    );
  }

  /* ── Error ── */
  if (state === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <AlertCircle size={48} className="text-red-400" />
        <p className="text-red-600 font-semibold text-center">{errorMsg}</p>
      </div>
    );
  }

  /* ── Already used ── */
  if (state === 'used') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 w-full max-w-sm text-center space-y-2">
          <AlertCircle size={40} className="text-amber-500 mx-auto" />
          <h2 className="font-bold text-lg text-amber-800">Already Used</h2>
          <p className="font-medium text-amber-700">{unitInfo?.component_name}</p>
          {unitInfo?.sku && <p className="text-xs text-gray-400 font-mono">SKU: {unitInfo.sku}</p>}
          {unitInfo?.used_at && (
            <p className="text-xs text-gray-500 mt-3">
              Used on <span className="font-medium">{unitInfo.used_at}</span>
            </p>
          )}
          {unitInfo?.used_by_name && (
            <p className="text-xs text-gray-500">by <span className="font-medium">{unitInfo.used_by_name}</span></p>
          )}
        </div>
      </div>
    );
  }

  /* ── Defective / already failed ── */
  if (state === 'defective') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 w-full max-w-sm text-center space-y-2">
          <XCircle size={40} className="text-red-500 mx-auto" />
          <h2 className="font-bold text-lg text-red-800">Marked as Defective</h2>
          <p className="font-medium text-red-700">{unitInfo?.component_name}</p>
          {unitInfo?.sku && <p className="text-xs text-gray-400 font-mono">SKU: {unitInfo.sku}</p>}
          <p className="text-xs text-gray-500 mt-2">This unit has been removed from available stock.</p>
        </div>
      </div>
    );
  }

  /* ── Done / Success ── */
  if (state === 'done' && result) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 w-full max-w-sm text-center space-y-2">
          <CheckCircle2 size={48} className="text-emerald-500 mx-auto" />
          <h2 className="font-bold text-2xl text-emerald-800">Done!</h2>
          <p className="font-semibold text-emerald-700 text-lg">{result.componentName}</p>
          <div className="bg-white border border-emerald-100 rounded-xl px-4 py-3 mt-2">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Remaining Stock</div>
            <div className="text-3xl font-bold text-gray-800 mt-0.5">
              {result.remainingStock} <span className="text-base font-normal text-gray-400">{result.unit}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Failed / Marked defective ── */
  if (state === 'failed_done' && failResult) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 w-full max-w-sm text-center space-y-2">
          <XCircle size={48} className="text-red-500 mx-auto" />
          <h2 className="font-bold text-2xl text-red-800">Marked Defective</h2>
          <p className="font-semibold text-red-700 text-lg">{failResult.componentName}</p>
          <div className="bg-white border border-red-100 rounded-xl px-4 py-3 mt-2">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Remaining Stock</div>
            <div className="text-3xl font-bold text-gray-800 mt-0.5">{failResult.remainingStock}</div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Ready: confirm take-out ── */
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-sm space-y-4">
        {/* Component info card */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-blue-100 p-3 rounded-xl">
              <Package size={24} className="text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-xl text-gray-900 leading-tight">{unitInfo?.component_name}</h2>
              {unitInfo?.sku && <p className="text-xs text-gray-400 font-mono mt-0.5">SKU: {unitInfo.sku}</p>}
            </div>
          </div>

          <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
            <span className="text-sm text-gray-500">Current Stock</span>
            <span className="font-bold text-xl text-gray-800">
              {unitInfo?.current_stock}{' '}
              <span className="text-sm font-normal text-gray-400">{unitInfo?.stock_unit}</span>
            </span>
          </div>

          {unitInfo?.location && (
            <p className="text-xs text-gray-400 px-1 mt-2">📍 {unitInfo.location}</p>
          )}
        </div>

        {/* Big confirm button */}
        <button
          onClick={handleConfirm}
          disabled={confirming || failing}
          className="w-full py-5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xl flex items-center justify-center gap-3 transition-all disabled:opacity-50 active:scale-[0.98] shadow-lg"
        >
          {confirming ? (
            <Loader2 size={24} className="animate-spin" />
          ) : (
            <span className="text-2xl font-black">−1</span>
          )}
          {confirming ? 'Processing…' : 'Take Out This Unit'}
        </button>

        {/* Secondary: mark as defective */}
        <button
          onClick={handleFail}
          disabled={confirming || failing}
          className="w-full py-3 rounded-2xl border border-red-200 text-red-500 hover:bg-red-50 font-medium text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
        >
          {failing ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
          {failing ? 'Marking…' : 'Mark as Defective / Failed'}
        </button>

        <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
          <QrCode size={11} />
          Subtracts 1 unit from inventory
        </p>
      </div>
    </div>
  );
}
