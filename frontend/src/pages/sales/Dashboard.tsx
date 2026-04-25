import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TrendingUp, Users, CheckCircle2, Percent, DollarSign, PieChart, Bell, Plus, QrCode } from 'lucide-react';
import api from '../../utils/api';
import Modal from '../../components/Modal';
import jsQR from 'jsqr';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate, minutesSince } from '../../utils/helpers';
import { LeadStatusBadge } from '../../components/StatusBadge';
import { Lead, Followup } from '../../types';
import MonthlyReport from './MonthlyReport.tsx';

interface SalesSummary {
  leadsByStatus: { status: string; count: number }[];
  totalLeads: number;
  closedLeads: number;
  conversionRate: string;
  revenue: number;
  pipeline: number;
  dueTodayFollowups: number;
  recentLeads: Lead[];
  hotLeads: Lead[];
  needsFollowup: Lead[];
}

export default function SalesDashboard() {
  const navigate = useNavigate();
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Camera scan logic (real-time, with BarcodeDetector + jsQR fallback)
  const streamRef = useRef<MediaStream | null>(null);
  // Use a ref for loop control so the async loop always reads the current value
  // (React state is stale inside closures — refs are not)
  const shouldScanRef = useRef(false);

  const stopCamera = () => {
    shouldScanRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
    setCameraActive(false);
  };

  // startCameraScan is now synchronous — just opens the modal.
  // The actual camera work runs in the useEffect below, which fires AFTER
  // React renders the modal and videoRef.current is guaranteed to be set.
  const startCameraScan = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Camera not available. HTTPS is required for camera access.');
      return;
    }
    shouldScanRef.current = true;
    setQrModalOpen(true);
    setScanning(true);
    setCameraActive(true);
  };

  // Cancel/close modal and stop camera
  const handleCloseQrModal = () => {
    setQrModalOpen(false);
    stopCamera();
  };

  // Camera initialisation — runs after React renders the modal so videoRef.current is set.
  useEffect(() => {
    if (!qrModalOpen) return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Do NOT await play() — on iOS Safari the user gesture context is lost
          // after the async getUserMedia call, causing NotAllowedError which would
          // be caught below and kill the scanner. autoPlay attr handles playback.
          videoRef.current.play().catch(() => {});
        }

        // Create BarcodeDetector once — much cheaper than per-frame
        // @ts-ignore
        const barcodeDetector = ('BarcodeDetector' in window)
          // @ts-ignore
          ? (() => { try { return new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { return null; } })()
          : null;

        while (shouldScanRef.current && !cancelled) {
          await new Promise(r => setTimeout(r, 200));
          if (!shouldScanRef.current || cancelled) break;
          if (!videoRef.current || videoRef.current.videoWidth === 0) continue;
          const canvas = document.createElement('canvas');
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          let qrRaw: string | null = null;
          if (barcodeDetector) {
            try {
              // @ts-ignore
              const barcodes = await barcodeDetector.detect(canvas);
              if (barcodes.length > 0) qrRaw = barcodes[0].rawValue;
            } catch {}
          }
          if (!qrRaw) {
            try {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code?.data) qrRaw = code.data;
              }
            } catch {}
          }
          if (qrRaw) {
            stopCamera();
            setQrModalOpen(false);
            // If QR encodes one of our own app URLs (e.g. /inventory/use?unit=…)
            // extract the path and navigate in-app. Otherwise show the raw value.
            try {
              const url = new URL(qrRaw);
              if (url.origin === window.location.origin) {
                navigate(url.pathname + url.search);
              } else {
                toast.success(`QR: ${qrRaw}`);
              }
            } catch {
              // Not a URL — just show it
              toast.success(`QR: ${qrRaw}`);
            }
            return;
          }
        }
        if (!cancelled) stopCamera();
      } catch (err: any) {
        if (!cancelled) {
          stopCamera();
          toast.error(
            err?.name === 'NotAllowedError'
              ? 'Camera permission denied. Please allow camera access and try again.'
              : 'Camera unavailable. Make sure the site is loaded over HTTPS.',
          );
        }
      }
    })();

    return () => { cancelled = true; };
  }, [qrModalOpen]);

  // Stop camera if the component unmounts while scanning
  useEffect(() => () => stopCamera(), []);
  const [data, setData] = useState<SalesSummary | null>(null);
  const [dueFollowups, setDueFollowups] = useState<(Followup & { customer_name: string; lead_number: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/dashboard/sales'), api.get('/followups/due')])
      .then(([d, f]) => { setData(d.data); setDueFollowups(f.data.slice(0, 5)); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
  if (!data) return null;

  const stats = [
    { label: 'Total Leads',  value: data.totalLeads,              color: 'text-blue-600',    bg: 'bg-blue-50',    icon: <Users size={18} className="text-blue-400" /> },
    { label: 'Closed Deals', value: data.closedLeads,             color: 'text-emerald-600', bg: 'bg-emerald-50', icon: <CheckCircle2 size={18} className="text-emerald-400" /> },
    { label: 'Conv. Rate',   value: `${data.conversionRate}%`,    color: 'text-purple-600',  bg: 'bg-purple-50',  icon: <Percent size={18} className="text-purple-400" /> },
    { label: 'Revenue',      value: formatCurrency(data.revenue), color: 'text-teal-600',    bg: 'bg-teal-50',    icon: <DollarSign size={18} className="text-teal-400" /> },
    { label: 'Pipeline',     value: formatCurrency(data.pipeline),color: 'text-amber-600',   bg: 'bg-amber-50',   icon: <TrendingUp size={18} className="text-amber-400" /> },
    { label: 'Follow-ups',   value: data.dueTodayFollowups,       color: 'text-red-600',     bg: 'bg-red-50',     icon: <Bell size={18} className="text-red-400" /> },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <h1 className="page-title">Sales Dashboard</h1>
          <button className="btn btn-secondary flex items-center gap-2" onClick={startCameraScan} disabled={scanning}>
            <QrCode size={18} />
            {scanning ? 'Scanning…' : 'Scan QR'}
          </button>
        </div>
        <Link to="leads/new" className="btn-primary btn-sm md:btn">
          <Plus size={15} /><span className="hidden sm:inline">New Lead</span><span className="sm:hidden">New</span>
        </Link>
      </div>

      <Modal open={qrModalOpen} onClose={handleCloseQrModal} title="Scan QR Code">
        <div className="flex flex-col items-center gap-4">
          {/* ── Viewfinder ── */}
          <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ maxWidth: 320, aspectRatio: '1/1' }}>
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay muted playsInline
            />
            {/* dark vignette overlay */}
            <div className="absolute inset-0" style={{ background: 'radial-gradient(circle, transparent 45%, rgba(0,0,0,0.55) 100%)' }} />
            {/* scanning box */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative" style={{ width: '62%', height: '62%' }}>
                {/* corner brackets */}
                <span className="absolute top-0 left-0 w-7 h-7 border-t-4 border-l-4 border-green-400 rounded-tl-md" />
                <span className="absolute top-0 right-0 w-7 h-7 border-t-4 border-r-4 border-green-400 rounded-tr-md" />
                <span className="absolute bottom-0 left-0 w-7 h-7 border-b-4 border-l-4 border-green-400 rounded-bl-md" />
                <span className="absolute bottom-0 right-0 w-7 h-7 border-b-4 border-r-4 border-green-400 rounded-br-md" />
                {/* animated scan line */}
                <span
                  className="absolute left-1 right-1 h-0.5 rounded-full bg-green-400 shadow animate-qr-scan"
                  style={{ boxShadow: '0 0 6px 2px rgba(74,222,128,0.6)' }}
                />
              </div>
            </div>
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="text-white text-xs">Starting camera…</span>
              </div>
            )}
          </div>
          <p className="text-sm font-medium text-gray-700">Align QR code in the green frame</p>
          <p className="text-xs text-gray-400">Camera will detect the code automatically</p>
          <button className="btn btn-secondary w-full" onClick={handleCloseQrModal}>Cancel</button>
        </div>
      </Modal>

      {/* ── 🚨 Hot Leads — new leads not contacted within 5 min ── */}
      {data.hotLeads?.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-red-500 text-lg animate-pulse">🚨</span>
              <span className="font-bold text-red-700">Uncontacted New Leads — Act Immediately!</span>
              <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{data.hotLeads.length}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            {data.hotLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between bg-white border border-red-200 rounded p-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-400">{lead.lead_number}</span>
                  <span className="font-semibold text-sm text-gray-800">{lead.customer_name}</span>
                  {lead.customer_phone && <a href={`tel:${lead.customer_phone}`} className="text-xs text-blue-600">📞 {lead.customer_phone}</a>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-red-500 font-semibold">{minutesSince(lead.created_at)}m waiting</span>
                  <Link to={`leads/${lead.id}`} className="btn btn-danger btn-sm">Call Now</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ⏰ Needs Follow-up — active leads overdue for SOP check-in ── */}
      {data.needsFollowup?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-500 text-lg">⏰</span>
            <span className="font-bold text-amber-700">Overdue Follow-ups ({data.needsFollowup.length})</span>
            <span className="text-xs text-amber-600">— No contact in over 24 hours</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {data.needsFollowup.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between bg-white border border-amber-200 rounded p-2 gap-2">
                <div>
                  <span className="text-sm font-medium text-gray-800">{lead.customer_name}</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <LeadStatusBadge status={lead.status} />
                    {lead.product_type && <span className="text-xs text-gray-400">{lead.product_type}</span>}
                  </div>
                </div>
                <Link to={`leads/${lead.id}`} className="btn btn-secondary btn-sm shrink-0">Follow Up</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`card p-3.5 ${s.bg} border-0`}>
            <div className="flex items-center justify-between mb-2">{s.icon}</div>
            <div className={`text-xl font-bold tracking-tight ${s.color}`}>{s.value}</div>
            <div className="text-xs font-medium text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Leads by status */}
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-gray-800">Leads by Status</h2>
          </div>
          <div className="card-body">
            <div className="space-y-2">
              {data.leadsByStatus.map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-gray-600 truncate">{s.status.replace('_', ' ')}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min((s.count / data.totalLeads) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="w-6 text-xs font-semibold text-gray-700">{s.count}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Due Follow-ups */}
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-gray-800">Follow-ups Due Today</h2>
            <span className="badge-red">{data.dueTodayFollowups}</span>
          </div>
          <div className="card-body">
            {dueFollowups.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">No pending follow-ups 🎉</div>
            ) : (
              <div className="space-y-2">
                {dueFollowups.map((f) => (
                  <div key={f.id} className="flex items-start gap-2 p-2 bg-red-50 rounded-md border border-red-100">
                    <span className="text-sm">{f.type === 'call' ? '📞' : f.type === 'whatsapp' ? '💬' : f.type === 'email' ? '📧' : '👥'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs">{f.customer_name}</div>
                      <div className="text-xs text-gray-500 truncate">{f.notes}</div>
                      <div className="text-xs text-red-500">{formatDate(f.scheduled_at)}</div>
                    </div>
                    <Link to={`leads/${f.lead_id}`} className="text-xs text-blue-600 hover:underline shrink-0">View</Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card border-0 bg-transparent shadow-none p-0">
        <div className="page-header mb-4">
          <div>
            <h2 className="page-title text-lg">Performance Charts</h2>
            <p className="text-sm text-gray-500">Timeline-based trends for leads, payments, and orders.</p>
          </div>
          <Link to="reports" className="btn-secondary btn-sm md:btn">
            <PieChart size={15} />
            <span>Open Reports</span>
          </Link>
        </div>
        <MonthlyReport embedded />
      </div>

      {/* Recent leads */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-bold text-gray-800">Recent Leads</h2>
          <Link to="leads" className="text-xs text-blue-600 font-semibold hover:text-blue-700">View all →</Link>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-50">
          {data.recentLeads.map((lead) => (
            <Link key={lead.id} to={`leads/${lead.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-blue-500 font-bold">{lead.lead_number}</span>
                  <LeadStatusBadge status={lead.status} />
                </div>
                <div className="font-semibold text-sm text-gray-900 truncate mt-0.5">{lead.customer_name}</div>
                <div className="text-xs text-gray-400">{formatDate(lead.created_at)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-emerald-600">{formatCurrency(lead.estimated_value)}</div>
              </div>
            </Link>
          ))}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Lead #</th>
                <th className="table-th">Customer</th>
                <th className="table-th">Product</th>
                <th className="table-th">Status</th>
                <th className="table-th">Value</th>
                <th className="table-th">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.recentLeads.map((lead) => (
                <tr key={lead.id} className="table-tr">
                  <td className="table-td whitespace-nowrap">
                    <Link to={`leads/${lead.id}`} className="text-blue-600 hover:underline font-mono text-xs font-semibold">{lead.lead_number}</Link>
                  </td>
                  <td className="table-td font-medium whitespace-nowrap">{lead.customer_name}</td>
                  <td className="table-td text-gray-500 max-w-[180px] truncate">{lead.product_interest}</td>
                  <td className="table-td whitespace-nowrap"><LeadStatusBadge status={lead.status} /></td>
                  <td className="table-td font-medium whitespace-nowrap">{formatCurrency(lead.estimated_value)}</td>
                  <td className="table-td text-gray-400 whitespace-nowrap">{formatDate(lead.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
