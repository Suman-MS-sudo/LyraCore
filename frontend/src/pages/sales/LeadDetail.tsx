import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import api from '../../utils/api';
import { Lead, Followup, Quotation, LeadStatus, OrderStatus } from '../../types';
import { LeadStatusBadge } from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import {
  formatDate, formatDateTime, formatCurrency,
  formatTimeSince, minutesSince, parseIST,
  LEAD_STATUS_CONFIG, FOLLOWUP_TYPES, LOST_REASONS
} from '../../utils/helpers';
import { useAuth } from '../../contexts/AuthContext';

interface Product {
  id: string; name: string; model_code?: string;
  product_type: string; base_price?: number; is_active: number;
  hsn_sac_code?: string;
}
interface SelectedItem { product: Product; qty: number; }

const STATUS_FLOW: LeadStatus[] = ['NEW','CONTACTED','QUOTATION_SENT','FOLLOW_UP','NEGOTIATION','PARTIAL_PAYMENT','PAYMENT_CONFIRMED','CLOSED','LOST'];

/* ── Number to Words (Indian) ── */
const _ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven',
  'Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const _tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function _w(n: number): string {
  if (!n) return '';
  if (n < 20) return _ones[n];
  if (n < 100) return _tens[Math.floor(n/10)] + (n%10 ? ' '+_ones[n%10] : '');
  return _ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' '+_w(n%100) : '');
}
function numberToWords(amount: number): string {
  const n = Math.round(amount);
  if (!n) return 'Zero Rupees Only';
  const cr=Math.floor(n/10000000), lk=Math.floor((n%10000000)/100000),
        th=Math.floor((n%100000)/1000), rm=n%1000;
  return 'Indian Rupee ' + [cr?_w(cr)+' Crore':'', lk?_w(lk)+' Lakh':'',
    th?_w(th)+' Thousand':'', rm?_w(rm):''].filter(Boolean).join(' ') + ' Only';
}

type Tab = 'overview' | 'requirements' | 'followups' | 'quotations' | 'closure';

/* ─── SOP follow-up day schedule helper ─── */
function getSopFollowupDays(lead: any): { label: string; dueDate: Date; overdue: boolean; done: boolean }[] {
  const anchor = lead.first_contacted_at || lead.created_at;
  const base = new Date(anchor);
  const followupDone = (lead.followups || []).filter((f: any) => f.completed_at);
  return [
    { label: 'Day 1 – Call + WhatsApp reminder', dueDate: new Date(base.getTime() + 1 * 86400000), overdue: Date.now() > base.getTime() + 1 * 86400000, done: followupDone.length >= 1 },
    { label: 'Day 3 – Call + Clarification message', dueDate: new Date(base.getTime() + 3 * 86400000), overdue: Date.now() > base.getTime() + 3 * 86400000, done: followupDone.length >= 2 },
    { label: 'Day 5 – Final follow-up call', dueDate: new Date(base.getTime() + 5 * 86400000), overdue: Date.now() > base.getTime() + 5 * 86400000, done: followupDone.length >= 3 },
  ];
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/management') ? '/management' : '/sales';

  const [lead, setLead] = useState<Lead & { quotations: Quotation[]; followups: Followup[]; production: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Modals
  const [showStatusModal, setShowStatusModal]       = useState(false);
  const [showFollowupModal, setShowFollowupModal]   = useState(false);
  const [showQuotationModal, setShowQuotationModal] = useState(false);
  const [showProductionModal, setShowProductionModal] = useState(false);
  const [reqEdit, setReqEdit]                       = useState(false);
  const [reqItems, setReqItems]                     = useState<SelectedItem[]>([]);
  const [reqProductPick, setReqProductPick]         = useState('');
  const [showClosureModal, setShowClosureModal]     = useState(false);
  const [showEditCustomerModal, setShowEditCustomerModal] = useState(false);
  const [showEditProductModal, setShowEditProductModal] = useState(false);
  const [paymentModal, setPaymentModal]             = useState<{ quotationId: string; grandTotal: number } | null>(null);
  const [payType, setPayType]                       = useState<'full' | 'partial'>('full');
  const [payAmountInput, setPayAmountInput]         = useState('');
  const piPreviewRef                                = useRef<HTMLDivElement>(null);

  // Forms
  const [newStatus, setNewStatus]     = useState<LeadStatus>('NEW');
  const [lostReason, setLostReason]   = useState('');
  const [followupForm, setFollowupForm] = useState({ type: 'call', notes: '', scheduled_at: '', outcome: '' });
  const [quotationForm, setQuotationForm] = useState({ amount: '', discount: '', freight_charges: '', installation_charges: '', validity_date: '', payment_terms: '', notes: '' });
  const [quotationFile, setQuotationFile] = useState<File | null>(null);
  const [quotationStep, setQuotationStep] = useState<'form' | 'review'>('form');
  const [previewPiNumber, setPreviewPiNumber] = useState<string>('');
  const [companyInfo, setCompanyInfo] = useState<any>(null);
  const [productionForm, setProductionForm] = useState({ expected_delivery_date: '', priority: 'NORMAL', notes: '' });
  const [reqForm, setReqForm] = useState<any>({});
  const [closureForm, setClosureForm] = useState({ billing_name: '', gst_number: '', delivery_address: '' });
  const [editProductForm, setEditProductForm] = useState({
    product_interest: '', product_type: '', quantity: '',
    purchase_timeline: '', budget_range: '', customization_notes: '',
    requirement_type: 'standard', requirement_confirmed: 0, estimated_value: '',
  });
  const [editProductItems, setEditProductItems] = useState<SelectedItem[]>([]);
  const [editProductPick, setEditProductPick] = useState('');
  const [editCustomerForm, setEditCustomerForm] = useState({
    customer_name: '', customer_phone: '', customer_email: '', company: '',
    address: '', delivery_address: '', location: '', estimated_value: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

  const productTypes = [...new Set(products.map(p => p.product_type))];

  const fetchLead = () => api.get(`/leads/${id}`).then(r => { setLead(r.data); setLoading(false); });
  useEffect(() => {
    fetchLead();
    api.get('/products', { params: { active: 'true' } }).then(r => setProducts(r.data));
    api.get('/company-info').then(r => setCompanyInfo(r.data)).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (lead) {
      setReqForm({
        product_interest: lead.product_interest || '',
        product_type: lead.product_type || '',
        location: lead.location || '',
        quantity: lead.quantity || '',
        purchase_timeline: lead.purchase_timeline || '',
        budget_range: lead.budget_range || '',
        customization_notes: lead.customization_notes || '',
        requirement_type: lead.requirement_type || 'standard',
        requirement_confirmed: lead.requirement_confirmed || 0,
      });
      setClosureForm({
        billing_name: lead.billing_name || '',
        gst_number: lead.gst_number || '',
        delivery_address: lead.delivery_address || '',
      });
      setEditProductForm({
        product_interest: lead.product_interest || '',
        product_type: lead.product_type || '',
        quantity: lead.quantity || '',
        purchase_timeline: lead.purchase_timeline || '',
        budget_range: lead.budget_range || '',
        customization_notes: lead.customization_notes || '',
        requirement_type: lead.requirement_type || 'standard',
        requirement_confirmed: lead.requirement_confirmed || 0,
        estimated_value: lead.estimated_value ? String(lead.estimated_value) : '',
      });
      setEditProductItems([]);
      setEditCustomerForm({
        customer_name: lead.customer_name || '',
        customer_phone: lead.customer_phone || '',
        customer_email: lead.customer_email || '',
        company: lead.company || '',
        address: (lead as any).address || '',
        delivery_address: lead.delivery_address || '',
        location: lead.location || '',
        estimated_value: lead.estimated_value ? String(lead.estimated_value) : '',
        notes: lead.notes || '',
      });
    }
  }, [lead]);

  const canEdit = user?.role === 'management' || (user?.role === 'sales' && lead?.assigned_to === user.id);
  const canDelete = user?.role === 'management';

  async function handleDeleteLead() {
    if (!lead) return;
    if (!window.confirm(`Delete lead "${lead.customer_name}"? This will also remove all quotations and follow-ups. This cannot be undone.`)) return;
    try {
      await api.delete(`/leads/${lead.id}`);
      navigate(`${basePath}/leads`);
    } catch {
      alert('Failed to delete lead.');
    }
  }

  // Auto-fill quotation form when modal opens
  useEffect(() => {
    if (showQuotationModal && lead) {
      const d = new Date();
      d.setDate(d.getDate() + 15);
      const validityDefault = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
      const autoAmount = lead.estimated_value ? String(Math.round(lead.estimated_value / 1.18)) : '';
      setQuotationForm(prev => ({
        amount:                prev.amount || autoAmount,
        discount:              prev.discount || '',
        freight_charges:       prev.freight_charges || '',
        installation_charges:  prev.installation_charges || '',
        validity_date:         prev.validity_date || validityDefault,
        payment_terms:         prev.payment_terms || '50% advance, 50% on delivery',
        notes:                 prev.notes || '',
      }));
      setQuotationStep('form');
    }
  }, [showQuotationModal]);

  // Initialise reqItems from product_interest when edit mode opens
  useEffect(() => {
    if (!reqEdit || !lead) return;
    const s = lead.product_interest || '';
    const pattern = /(\d+)x\s+([^,(]+?)(?:\s*\(([^)]+)\))?(?=\s*,|\s*$)/gi;
    const parsed: SelectedItem[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(s)) !== null) {
      const qty = parseInt(m[1]);
      const name = m[2].trim();
      const sku = m[3]?.trim() || '';
      const hit = products.find(p => p.name === name || (sku && p.model_code === sku));
      parsed.push(hit
        ? { product: hit, qty }
        : { product: { id: `_c_${name}`, name, model_code: sku, product_type: lead.product_type || '', is_active: 1 }, qty }
      );
    }
    setReqItems(parsed);
    setReqProductPick('');
  }, [reqEdit]);

  const confirmedPayment = lead?.quotations?.some(q => q.payment_confirmed || q.payment_type === 'partial');
  const minsAgo = minutesSince(lead?.created_at);
  const isUncontacted = lead?.status === 'NEW' && !lead?.first_contacted_at && minsAgo >= 5;
  const showClosure = lead && ['NEGOTIATION','PARTIAL_PAYMENT','PAYMENT_CONFIRMED','CLOSED','LOST'].includes(lead.status);

  const patch = async (body: any) => {
    await api.patch(`/leads/${id}`, body);
    fetchLead();
  };

  const handleStatusChange = async () => {
    try {
      const body: any = { status: newStatus };
      if (newStatus === 'LOST' && lostReason) body.lost_reason = lostReason;
      await patch(body);
      toast.success('Status updated');
      setShowStatusModal(false);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const handleAddFollowup = async () => {
    if (!followupForm.notes) return toast.error('Notes required');
    setSaving(true);
    try {
      await api.post('/followups', { lead_id: id, ...followupForm });
      toast.success('Follow-up logged');
      setShowFollowupModal(false);
      setFollowupForm({ type: 'call', notes: '', scheduled_at: '', outcome: '' });
      fetchLead();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleUploadQuotation = async (doSendEmail: boolean) => {
    if (!quotationForm.amount) return toast.error('Amount required');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('lead_id', id!);
      fd.append('amount', quotationForm.amount);
      fd.append('discount', quotationForm.discount || '0');
      fd.append('freight_charges', quotationForm.freight_charges || '0');
      fd.append('installation_charges', quotationForm.installation_charges || '0');
      fd.append('validity_date', quotationForm.validity_date);
      fd.append('payment_terms', quotationForm.payment_terms);
      fd.append('notes', quotationForm.notes);
      fd.append('send_email', doSendEmail ? 'true' : 'false');
      if (quotationFile) fd.append('file', quotationFile);
      const res = await api.post('/quotations', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (doSendEmail) {
        if (res.data.emailStatus?.sent) toast.success('Quotation created & email sent!');
        else {
          toast.success('Quotation saved');
          toast.error(`Email failed: ${res.data.emailStatus?.error || 'unknown error'}`);
        }
      } else {
        toast.success('Quotation saved');
      }
      setShowQuotationModal(false);
      setQuotationForm({ amount: '', discount: '', freight_charges: '', installation_charges: '', validity_date: '', payment_terms: '', notes: '' });
      setQuotationFile(null);
      setQuotationStep('form');
      fetchLead();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleConfirmPayment = (q: Quotation) => {
    const afterDisc = q.amount - (q.discount || 0);
    const freight   = q.freight_charges || 0;
    const install   = q.installation_charges || 0;
    const grandTotal = afterDisc + Math.round(afterDisc * 0.18)
      + (freight > 0 ? freight + Math.round(freight * 0.18) : 0)
      + (install > 0 ? install + Math.round(install * 0.18) : 0);
    setPayType('full');
    setPayAmountInput('');
    setPaymentModal({ quotationId: q.id, grandTotal });
  };

  const [downloadingPdf, setDownloadingPdf]         = useState(false);

  const handleDownloadPdf = async () => {
    if (!piPreviewRef.current) return;
    setDownloadingPdf(true);
    const piNumber = previewPiNumber || (lead?.quotations?.length
      ? `Q-${String(lead.quotations.length + 1).padStart(4, '0')}`
      : 'Quotation');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opt: any = {
      margin:      [8, 8, 8, 8],
      filename:    `${piNumber}-${lead?.customer_name || 'Quote'}.pdf`,
      image:       { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
    };
    try {
      await html2pdf().set(opt).from(piPreviewRef.current).save();
    } catch (e) {
      toast.error('Failed to generate PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleSubmitPayment = async () => {
    if (!paymentModal) return;
    if (payType === 'partial') {
      const paid = parseFloat(payAmountInput);
      if (!paid || paid <= 0) return toast.error('Enter a valid amount paid');
      if (paid >= paymentModal.grandTotal) return toast.error('For full payment, choose "Full Payment" option');
    }
    setSaving(true);
    try {
      await api.patch(`/quotations/${paymentModal.quotationId}/confirm-payment`, {
        paymentType: payType,
        amountPaid: payType === 'partial' ? parseFloat(payAmountInput) : 0,
      });
      toast.success(payType === 'full' ? 'Payment confirmed! Production unlocked.' : 'Partial payment recorded.');
      setPaymentModal(null);
      fetchLead();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleCreateProduction = async () => {
    const confirmedQ = lead?.quotations?.find(q => q.payment_confirmed || q.payment_type === 'partial');
    if (!confirmedQ) return toast.error('No confirmed payment found');
    setSaving(true);
    try {
      await api.post('/production', { lead_id: id, quotation_id: confirmedQ.id, ...productionForm });
      toast.success('Production order created!');
      setShowProductionModal(false);
      fetchLead();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleSaveRequirements = async () => {
    setSaving(true);
    try {
      await patch(reqForm);
      toast.success('Requirements saved');
      setReqEdit(false);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleSaveClosure = async () => {
    setSaving(true);
    try {
      await patch(closureForm);
      toast.success('Closure details saved');
      setShowClosureModal(false);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400">Loading...</div>;
  if (!lead) return <div className="text-gray-400 text-center py-10">Lead not found</div>;

  const sopDays = getSopFollowupDays(lead);

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview',     label: 'Overview' },
    { key: 'requirements', label: 'Requirements', badge: lead.requirement_confirmed ? undefined : 1 },
    { key: 'followups',    label: 'Follow-ups', badge: lead.followups?.filter((f: any) => !f.completed_at).length || undefined },
    { key: 'quotations',   label: 'Quotations', badge: lead.quotations?.filter((q: Quotation) => !q.payment_confirmed && q.payment_type !== 'partial').length || undefined },
    ...(showClosure ? [{ key: 'closure' as Tab, label: 'Closure / Lost' }] : []),
  ];

  return (
    <div className="space-y-4 max-w-5xl mx-auto">

      {/* ── 5-min SLA Alert ── */}
      {isUncontacted && canEdit && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-red-500 text-xl animate-pulse">🚨</span>
            <div>
              <div className="font-semibold text-red-700 text-sm">Lead not contacted yet — {minsAgo} minutes since receipt!</div>
              <div className="text-xs text-red-600">SOP requires contact within 5 minutes. Call immediately.</div>
            </div>
          </div>
          <a href={`tel:${lead.customer_phone}`} className="btn btn-danger btn-sm shrink-0">📞 Call Now</a>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <button onClick={() => navigate(`${basePath}/leads`)} className="text-gray-400 hover:text-gray-600">←</button>
            <span className="font-mono text-xs text-gray-400">{lead.lead_number}</span>
            <LeadStatusBadge status={lead.status} />
            {lead.product_type && (
              <span className="badge badge-blue text-xs">{lead.product_type}</span>
            )}
            {lead.requirement_type === 'custom' && (
              <span className="badge badge-purple text-xs">Custom</span>
            )}
          </div>
          <h1 className="text-xl font-bold text-gray-900">{lead.customer_name}</h1>
          {lead.company && <div className="text-gray-500 text-sm">{lead.company}</div>}
          <div className="text-xs text-gray-400 mt-1">
            Received {formatTimeSince(lead.created_at)}
            {lead.first_contacted_at && <span className="ml-2 text-green-600">· First contacted {formatTimeSince(lead.first_contacted_at)}</span>}
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setNewStatus(lead.status); setLostReason(lead.lost_reason || ''); setShowStatusModal(true); }} className="btn btn-secondary btn-sm">Change Status</button>
            <button onClick={() => setShowFollowupModal(true)} className="btn btn-secondary btn-sm">+ Follow-up</button>
            <button onClick={() => setShowQuotationModal(true)} className="btn btn-secondary btn-sm">+ Quotation</button>
            {confirmedPayment && !lead.production && (
              <button onClick={() => setShowProductionModal(true)} className="btn btn-success btn-sm">🏭 Create Order</button>
            )}
            {canDelete && (
              <button onClick={handleDeleteLead} className="btn btn-danger btn-sm">🗑 Delete Lead</button>
            )}
          </div>
        )}
      </div>

      {/* ── Quick Contact Bar ── */}
      <div className="flex gap-2 flex-wrap">
        <a href={`tel:${lead.customer_phone}`} className="btn btn-secondary btn-sm">📞 Call {lead.customer_phone}</a>
        <a href={`https://wa.me/${lead.customer_phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">💬 WhatsApp</a>
        {lead.customer_email && (
          <a href={`mailto:${lead.customer_email}`} className="btn btn-secondary btn-sm">📧 Email</a>
        )}
        {lead.production && (
          <span className="text-xs text-green-600 font-medium flex items-center gap-1 ml-2">🏭 Order: {lead.production.order_number}</span>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="card">
        <div className="border-b border-gray-100 flex overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 shrink-0 ${
                activeTab === tab.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.badge ? <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{tab.badge}</span> : null}
            </button>
          ))}
        </div>

        <div className="p-4">

          {/* ════ OVERVIEW ════ */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Contact</div>
                    {canEdit && (
                      <button onClick={() => setShowEditCustomerModal(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">✏️ Edit</button>
                    )}
                  </div>
                  <div className="font-semibold text-sm text-gray-900">{lead.customer_name}</div>
                  {lead.company && <div className="text-xs text-gray-500">{lead.company}</div>}
                  <div className="flex items-center gap-2 text-sm">📞 <a href={`tel:${lead.customer_phone}`} className="text-blue-600">{lead.customer_phone}</a></div>
                  {lead.customer_email && <div className="flex items-center gap-2 text-sm">📧 <a href={`mailto:${lead.customer_email}`} className="text-blue-600">{lead.customer_email}</a></div>}
                  <div className="text-sm text-gray-500 capitalize">📌 {lead.source.replace('_', ' ')}</div>
                  {lead.location && <div className="text-sm text-gray-500">🏢 {lead.location}</div>}
                  {((lead as any).address || lead.delivery_address) && (
                    <div className="mt-1 text-xs bg-gray-50 rounded p-2 border">
                      <div className="font-semibold text-gray-400 uppercase mb-0.5">Address</div>
                      <div className="whitespace-pre-wrap text-gray-700">{(lead as any).address || lead.delivery_address}</div>
                      {lead.delivery_address && (lead as any).address && lead.delivery_address !== (lead as any).address && (
                        <div className="mt-1.5">
                          <div className="font-semibold text-gray-400 uppercase mb-0.5">Delivery Address</div>
                          <div className="whitespace-pre-wrap text-gray-700">{lead.delivery_address}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Product</div>
                    {canEdit && (
                      <button onClick={() => setShowEditProductModal(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">✏️ Edit</button>
                    )}
                  </div>
                  <div className="text-sm text-gray-800 font-medium">{lead.product_interest}</div>
                  {lead.quantity && <div className="text-sm text-gray-500">Qty: {lead.quantity}</div>}
                  {lead.purchase_timeline && <div className="text-sm text-gray-500">Timeline: {lead.purchase_timeline}</div>}
                  {lead.budget_range && <div className="text-sm text-gray-500">Budget: {lead.budget_range}</div>}
                  {lead.estimated_value && <div className="text-sm font-semibold text-emerald-600">{formatCurrency(lead.estimated_value)}</div>}
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Team</div>
                  <div className="text-sm text-gray-600">Assigned: {lead.assigned_name}</div>
                  <div className="text-xs text-gray-400">Created: {formatDateTime(lead.created_at)}</div>
                  <div className="text-xs text-gray-400">Updated: {formatDateTime(lead.updated_at)}</div>
                </div>
              </div>

              {/* Status pipeline */}
              <div>
                <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Pipeline</div>
                <div className="flex items-center gap-1 overflow-x-auto pb-1 flex-wrap">
                  {STATUS_FLOW.filter(s => s !== 'LOST').map((s, i) => (
                    <div key={s} className="flex items-center gap-1 shrink-0">
                      {i > 0 && <div className="w-4 h-px bg-gray-300" />}
                      <div className={`text-xs px-2 py-1 rounded-full ${
                        lead.status === s ? 'bg-blue-600 text-white font-semibold' :
                        STATUS_FLOW.indexOf(lead.status) > STATUS_FLOW.indexOf(s) ? 'bg-green-100 text-green-700' :
                        'bg-gray-100 text-gray-400'
                      }`}>
                        {LEAD_STATUS_CONFIG[s].label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order Status pipeline */}
              {lead.production && (() => {
                const ORDER_STAGES: OrderStatus[] = ['PENDING','FABRICATION','ASSEMBLY','TESTING','PACKAGING','DISPATCHED','INSTALLATION','COMPLETED'];
                const ORDER_LABELS: Record<OrderStatus, string> = {
                  PENDING: 'Pending', FABRICATION: 'Fabrication', ASSEMBLY: 'Assembly',
                  TESTING: 'Testing', PACKAGING: 'Packaging', DISPATCHED: 'Dispatched',
                  INSTALLATION: 'Installation', COMPLETED: 'Completed',
                };
                const curIdx = ORDER_STAGES.indexOf(lead.production.status);
                return (
                  <div>
                    <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                      Order Status — <span className="text-gray-600">{lead.production.order_number}</span>
                    </div>
                    <div className="flex items-center gap-1 overflow-x-auto pb-1 flex-wrap">
                      {ORDER_STAGES.map((s, i) => (
                        <div key={s} className="flex items-center gap-1 shrink-0">
                          {i > 0 && <div className="w-3 h-px bg-gray-300" />}
                          <div className={`text-xs px-2 py-1 rounded-full ${
                            lead.production!.status === s ? 'bg-indigo-600 text-white font-semibold' :
                            curIdx > i ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-400'
                          }`}>
                            {ORDER_LABELS[s]}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Payment Summary */}
              {(() => {
                const pq = lead.quotations?.find((q: Quotation) => q.payment_confirmed || q.payment_type === 'partial');
                if (!pq) return null;
                const afterDisc  = pq.amount - (pq.discount || 0);
                const freight    = (pq as any).freight_charges || 0;
                const install    = (pq as any).installation_charges || 0;
                const grandTotal = afterDisc + Math.round(afterDisc * 0.18)
                  + (freight > 0 ? freight + Math.round(freight * 0.18) : 0)
                  + (install > 0 ? install + Math.round(install * 0.18) : 0);
                const paid       = pq.payment_type === 'partial' ? (pq.amount_paid || 0) : grandTotal;
                const remaining  = grandTotal - paid;
                return (
                  <div className="rounded-lg border overflow-hidden">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-2 bg-gray-50 border-b">
                      Payment — {pq.pi_number}
                    </div>
                    <div className="grid grid-cols-3 divide-x text-center">
                      <div className="p-3">
                        <div className="text-xs text-gray-400 mb-0.5">Grand Total</div>
                        <div className="text-sm font-bold text-gray-800">{formatCurrency(grandTotal)}</div>
                      </div>
                      <div className="p-3">
                        <div className="text-xs text-gray-400 mb-0.5">Paid</div>
                        <div className="text-sm font-bold text-green-600">{formatCurrency(paid)}</div>
                      </div>
                      <div className="p-3">
                        <div className="text-xs text-gray-400 mb-0.5">Remaining</div>
                        <div className={`text-sm font-bold ${remaining > 0 ? 'text-orange-500' : 'text-green-600'}`}>
                          {remaining > 0 ? formatCurrency(remaining) : '✓ Settled'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {lead.notes && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wider">Notes</div>
                  <div className="text-sm text-gray-700 bg-gray-50 rounded p-3 whitespace-pre-wrap">{lead.notes}</div>
                </div>
              )}
            </div>
          )}

          {/* ════ REQUIREMENTS ════ */}
          {activeTab === 'requirements' && (
            <div className="space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-gray-700">Requirement Details</div>
                  {lead.requirement_confirmed
                    ? <span className="badge badge-green text-xs">✓ Confirmed</span>
                    : <span className="badge badge-yellow text-xs">⚠ Not confirmed</span>}
                </div>
                {canEdit && (
                  reqEdit
                    ? <div className="flex gap-2">
                        <button onClick={() => setReqEdit(false)} className="btn btn-secondary btn-sm">Cancel</button>
                        <button onClick={async () => { await handleSaveRequirements(); setReqEdit(false); }} disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save Changes'}</button>
                      </div>
                    : <button onClick={() => setReqEdit(true)} className="btn btn-secondary btn-sm">✏️ Edit Requirements</button>
                )}
              </div>

              {/* Table */}
              <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-44">Field</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {/* Product */}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-medium text-gray-500 align-top">Product</td>
                      <td className="px-4 py-3">
                        {reqEdit ? (
                          <div className="space-y-2">
                            {/* Catalog picker */}
                            {products.length > 0 && (
                              <div className="flex gap-2">
                                <select className="form-input text-sm flex-1" value={reqProductPick} onChange={e => setReqProductPick(e.target.value)}>
                                  <option value="">— Add from catalogue —</option>
                                  {productTypes.map(type => (
                                    <optgroup key={type} label={type}>
                                      {products.filter(p => p.product_type === type).map(p => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}{p.model_code ? ` — ${p.model_code}` : ''}{p.base_price ? ` (₹${p.base_price.toLocaleString('en-IN')})` : ''}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                                <button type="button" disabled={!reqProductPick} className="btn btn-secondary btn-sm px-3 shrink-0"
                                  onClick={() => {
                                    const product = products.find(p => p.id === reqProductPick);
                                    if (!product) return;
                                    const updated = (() => {
                                      const ex = reqItems.find(i => i.product.id === product.id);
                                      return ex ? reqItems.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i) : [...reqItems, { product, qty: 1 }];
                                    })();
                                    const lines = updated.map(i => `${i.qty}x ${i.product.name}${i.product.model_code ? ` (${i.product.model_code})` : ''}`);
                                    const types = [...new Set(updated.map(i => i.product.product_type).filter(Boolean))];
                                    const qty   = updated.reduce((s, i) => s + i.qty, 0);
                                    setReqItems(updated);
                                    setReqForm((p: any) => ({ ...p, product_interest: lines.join(', '), product_type: types.join(', '), quantity: String(qty) }));
                                    setReqProductPick('');
                                  }}>
                                  + Add
                                </button>
                              </div>
                            )}
                            {/* Items table */}
                            {reqItems.length > 0 && (
                              <div className="border border-gray-200 rounded-lg overflow-hidden text-sm">
                                <table className="w-full">
                                  <thead className="bg-gray-50 border-b">
                                    <tr>
                                      <th className="text-left px-3 py-1.5 text-xs text-gray-500">Product</th>
                                      <th className="text-left px-3 py-1.5 text-xs text-gray-500">SKU</th>
                                      <th className="text-center px-2 py-1.5 text-xs text-gray-500 w-24">Qty</th>
                                      <th className="w-6"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {reqItems.map(({ product, qty }) => {
                                      const applyUpdate = (updated: SelectedItem[]) => {
                                        const lines = updated.map(i => `${i.qty}x ${i.product.name}${i.product.model_code ? ` (${i.product.model_code})` : ''}`);
                                        const types = [...new Set(updated.map(i => i.product.product_type).filter(Boolean))];
                                        const q = updated.reduce((s, i) => s + i.qty, 0);
                                        setReqItems(updated);
                                        setReqForm((p: any) => ({ ...p, product_interest: lines.join(', '), product_type: types.join(', '), quantity: String(q) }));
                                      };
                                      return (
                                        <tr key={product.id}>
                                          <td className="px-3 py-2">
                                            <div className="font-medium text-gray-800">{product.name}</div>
                                          </td>
                                          <td className="px-3 py-2 font-mono text-xs text-gray-500">{product.model_code || '—'}</td>
                                          <td className="px-2 py-2">
                                            <div className="flex items-center justify-center gap-1">
                                              <button type="button" onClick={() => applyUpdate(
                                                qty <= 1 ? reqItems.filter(i => i.product.id !== product.id)
                                                         : reqItems.map(i => i.product.id === product.id ? { ...i, qty: i.qty - 1 } : i)
                                              )} className="w-5 h-5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">−</button>
                                              <span className="w-6 text-center font-semibold">{qty}</span>
                                              <button type="button" onClick={() => applyUpdate(
                                                reqItems.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i)
                                              )} className="w-5 h-5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">+</button>
                                            </div>
                                          </td>
                                          <td className="px-1 py-2">
                                            <button type="button" onClick={() => applyUpdate(reqItems.filter(i => i.product.id !== product.id))}
                                              className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {reqItems.length === 0 && (
                              <div className="text-xs text-gray-400 italic">No products added yet. Pick from catalogue above.</div>
                            )}
                          </div>
                        ) : (() => {
                          const s = lead.product_interest || '';
                          const pattern = /(\d+)x\s+([^,(]+?)(?:\s*\(([^)]+)\))?(?=\s*,|\s*$)/gi;
                          const items: Array<{qty: number; name: string; sku: string}> = [];
                          let m: RegExpExecArray | null;
                          while ((m = pattern.exec(s)) !== null) {
                            items.push({ qty: parseInt(m[1]), name: m[2].trim(), sku: m[3]?.trim() || '' });
                          }
                          if (items.length === 0) return <span className={s ? 'font-medium text-gray-800' : 'text-gray-300 italic'}>{s || 'Not filled'}</span>;
                          return (
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b">
                                  <tr>
                                    <th className="text-left px-3 py-1.5 text-xs text-gray-500 font-semibold">Product</th>
                                    <th className="text-left px-3 py-1.5 text-xs text-gray-500 font-semibold">SKU / Model</th>
                                    <th className="text-center px-3 py-1.5 text-xs text-gray-500 font-semibold">Qty</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {items.map((item, i) => (
                                    <tr key={i} className="hover:bg-gray-50">
                                      <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{item.sku || '—'}</td>
                                      <td className="px-3 py-2 text-center">
                                        <span className="inline-block min-w-[28px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">{item.qty}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                    {/* Location */}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-medium text-gray-500">Installation Location</td>
                      <td className="px-4 py-3">
                        {reqEdit
                          ? <input className="form-input text-sm" value={reqForm.location || ''} onChange={e => setReqForm((p: any) => ({ ...p, location: e.target.value }))} placeholder="City / Site" />
                          : <span className={lead.location ? 'font-medium text-gray-800' : 'text-gray-300 italic'}>{lead.location || 'Not filled'}</span>}
                      </td>
                    </tr>
                    {/* Quantity */}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-medium text-gray-500">Quantity</td>
                      <td className="px-4 py-3">
                        {reqEdit
                          ? <input className="form-input text-sm" value={reqForm.quantity || ''} onChange={e => setReqForm((p: any) => ({ ...p, quantity: e.target.value }))} placeholder="e.g. 2 units" />
                          : <span className={lead.quantity ? 'font-medium text-gray-800' : 'text-gray-300 italic'}>{lead.quantity || 'Not filled'}</span>}
                      </td>
                    </tr>
                    {/* Purchase Timeline */}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-medium text-gray-500">Purchase Timeline</td>
                      <td className="px-4 py-3">
                        {reqEdit
                          ? <input className="form-input text-sm" value={reqForm.purchase_timeline || ''} onChange={e => setReqForm((p: any) => ({ ...p, purchase_timeline: e.target.value }))} placeholder="e.g. This month" />
                          : <span className={lead.purchase_timeline ? 'font-medium text-gray-800' : 'text-gray-300 italic'}>{lead.purchase_timeline || 'Not filled'}</span>}
                      </td>
                    </tr>
                    {/* Budget */}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-medium text-gray-500">Budget Range</td>
                      <td className="px-4 py-3">
                        {reqEdit
                          ? <input className="form-input text-sm" value={reqForm.budget_range || ''} onChange={e => setReqForm((p: any) => ({ ...p, budget_range: e.target.value }))} placeholder="e.g. ₹1L–₹2L" />
                          : <span className={lead.budget_range ? 'font-medium text-gray-800' : 'text-gray-300 italic'}>{lead.budget_range || 'Not filled'}</span>}
                      </td>
                    </tr>
                    {/* Solution Type */}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-medium text-gray-500">Solution Type</td>
                      <td className="px-4 py-3">
                        {reqEdit
                          ? <select className="form-input text-sm" value={reqForm.requirement_type || 'standard'} onChange={e => setReqForm((p: any) => ({ ...p, requirement_type: e.target.value }))}>
                              <option value="standard">Standard Model</option>
                              <option value="custom">Customised Solution</option>
                            </select>
                          : <span className="font-medium text-gray-800">{lead.requirement_type === 'custom' ? '🔧 Custom Solution' : '📦 Standard Model'}</span>}
                      </td>
                    </tr>
                    {/* Customisation Notes */}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-medium text-gray-500 align-top">Customisation Notes</td>
                      <td className="px-4 py-3">
                        {reqEdit
                          ? <textarea rows={3} className="form-input text-sm" value={reqForm.customization_notes || ''} onChange={e => setReqForm((p: any) => ({ ...p, customization_notes: e.target.value }))} placeholder="Describe any custom requirements…" />
                          : <span className={lead.customization_notes ? 'font-medium text-gray-800 whitespace-pre-wrap' : 'text-gray-300 italic'}>{lead.customization_notes || 'None'}</span>}
                      </td>
                    </tr>
                    {/* Confirmed */}
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-medium text-gray-500">Confirmed with Customer</td>
                      <td className="px-4 py-3">
                        {reqEdit
                          ? <label className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" className="rounded" checked={!!reqForm.requirement_confirmed}
                                onChange={e => setReqForm((p: any) => ({ ...p, requirement_confirmed: e.target.checked ? 1 : 0 }))} />
                              <span className="text-sm text-gray-700">Mark as confirmed</span>
                            </label>
                          : lead.requirement_confirmed
                            ? <span className="badge badge-green">✓ Yes — confirmed</span>
                            : <span className="badge badge-yellow">⚠ Not yet confirmed</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {!lead.requirement_confirmed && !reqEdit && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  ⚠ Requirements not yet confirmed with customer. Click <strong>Edit Requirements</strong> to update and mark as confirmed.
                </div>
              )}
            </div>
          )}

          {/* ════ FOLLOW-UPS ════ */}
          {activeTab === 'followups' && (
            <div className="space-y-4">
              {/* SOP Follow-up Schedule */}
              {['CONTACTED','QUOTATION_SENT','FOLLOW_UP','NEGOTIATION'].includes(lead.status) && (
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-blue-600 mb-2 uppercase tracking-wider">SOP Follow-up Schedule</div>
                  <div className="space-y-1.5">
                    {sopDays.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span>{d.done ? '✅' : d.overdue ? '🔴' : '⏳'}</span>
                        <span className={`font-medium ${d.done ? 'text-green-600 line-through' : d.overdue ? 'text-red-600' : 'text-gray-600'}`}>
                          {d.label}
                        </span>
                        <span className="text-gray-400 ml-auto">{formatDate(d.dueDate?.toISOString())}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canEdit && (
                <button onClick={() => setShowFollowupModal(true)} className="btn btn-primary btn-sm">+ Log Follow-up</button>
              )}

              {lead.followups?.length === 0 ? (
                <div className="text-gray-400 text-sm text-center py-6">No follow-ups logged yet</div>
              ) : (
                <div className="space-y-2">
                  {lead.followups?.map((f: any) => (
                    <div key={f.id} className={`flex gap-3 p-3 rounded-md border ${f.completed_at ? 'bg-gray-50 border-gray-100' : 'bg-amber-50 border-amber-100'}`}>
                      <div className="text-lg shrink-0">{f.type === 'call' ? '📞' : f.type === 'whatsapp' ? '💬' : f.type === 'email' ? '📧' : '👥'}</div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-xs font-semibold capitalize">{f.type}</span>
                          <span className="text-xs text-gray-400">by {f.user_name}</span>
                          {f.completed_at && <span className="badge badge-green text-xs">Done</span>}
                          {!f.completed_at && f.scheduled_at && <span className="badge badge-yellow text-xs">Scheduled {formatDate(f.scheduled_at)}</span>}
                        </div>
                        <div className="text-sm text-gray-700">{f.notes}</div>
                        {f.outcome && <div className="text-xs text-green-700 mt-1 font-medium">→ {f.outcome}</div>}
                        <div className="text-xs text-gray-400 mt-0.5">{formatDateTime(f.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ════ QUOTATIONS ════ */}
          {activeTab === 'quotations' && (
            <div className="space-y-3">
              {canEdit && (
                <button onClick={() => setShowQuotationModal(true)} className="btn btn-primary btn-sm">✉ + Quotation</button>
              )}
              {lead.quotations?.length === 0 ? (
                <div className="text-gray-400 text-sm text-center py-6">No quotations uploaded yet</div>
              ) : lead.quotations?.map((q: any) => (
                <div key={q.id} className={`p-3 rounded-md border ${q.payment_confirmed ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold">{q.pi_number}</span>
                        {q.payment_confirmed
                          ? <span className="badge badge-green">✓ Payment Confirmed</span>
                          : q.payment_type === 'partial'
                            ? <span className="badge badge-orange">⏳ Partial Payment</span>
                            : <span className="badge badge-yellow">Awaiting Payment</span>}
                        {q.email_sent ? <span className="badge badge-blue text-xs">✉ Emailed</span> : null}
                      </div>
                      <div className="text-xl font-bold text-gray-900 mt-1">{(() => {
                        const afterDisc = q.amount - (q.discount || 0);
                        const freight   = q.freight_charges || 0;
                        const install   = q.installation_charges || 0;
                        const gTotal    = afterDisc + Math.round(afterDisc * 0.18)
                          + (freight > 0 ? freight + Math.round(freight * 0.18) : 0)
                          + (install > 0 ? install + Math.round(install * 0.18) : 0);
                        return formatCurrency(gTotal);
                      })()}</div>
                      <div className="text-xs text-gray-400 mt-0.5 space-y-0.5">
                        <span>Base: {formatCurrency(q.amount)}</span>
                        {q.discount > 0 && <span className="text-red-500"> · Discount: −{formatCurrency(q.discount)}</span>}
                        {(q.freight_charges || 0) > 0 && <span> · Freight: {formatCurrency(q.freight_charges)}</span>}
                        {(q.installation_charges || 0) > 0 && <span> · Install: {formatCurrency(q.installation_charges)}</span>}
                        <span className="text-gray-300"> · incl. 18% GST</span>
                      </div>
                      {q.payment_type === 'partial' && q.amount_paid ? (() => {
                        const afterDisc = q.amount - (q.discount || 0);
                        const freight = q.freight_charges || 0;
                        const install = q.installation_charges || 0;
                        const gTotal = afterDisc + Math.round(afterDisc * 0.18)
                          + (freight > 0 ? freight + Math.round(freight * 0.18) : 0)
                          + (install > 0 ? install + Math.round(install * 0.18) : 0);
                        const remaining = gTotal - q.amount_paid;
                        return (
                          <div className="mt-1 text-xs space-y-0.5">
                            <div className="text-green-600 font-semibold">Paid: {formatCurrency(q.amount_paid)}</div>
                            <div className="text-orange-500 font-semibold">Remaining: {formatCurrency(remaining)}</div>
                          </div>
                        );
                      })() : null}
                      {q.validity_date && (
                        <div className={`text-xs mt-0.5 ${new Date(q.validity_date) < new Date() ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>
                          {new Date(q.validity_date) < new Date() ? '⚠ Expired: ' : 'Valid until: '}{formatDate(q.validity_date)}
                        </div>
                      )}
                      {q.payment_terms && <div className="text-xs text-gray-500">Terms: {q.payment_terms}</div>}
                      {q.notes && <div className="text-xs text-gray-500 mt-1">{q.notes}</div>}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {q.file_path && <a href={`/${q.file_path}`} target="_blank" className="btn btn-secondary btn-sm">📄 View</a>}
                      {!q.payment_confirmed && canEdit && (
                        <button onClick={() => handleConfirmPayment(q)} className="btn btn-success btn-sm">✓ Confirm Payment</button>
                      )}
                      {!q.payment_confirmed && canEdit && (
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Delete ${q.pi_number}? This cannot be undone.`)) return;
                            try {
                              await api.delete(`/quotations/${q.id}`);
                              toast.success(`${q.pi_number} deleted`);
                              fetchLead();
                            } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to delete'); }
                          }}
                          className="btn btn-sm border border-red-200 text-red-500 hover:bg-red-50"
                        >
                          🗑 Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-2">{formatDateTime(q.created_at)}</div>
                </div>
              ))}
            </div>
          )}

          {/* ════ CLOSURE / LOST ════ */}
          {activeTab === 'closure' && (
            <div className="space-y-4">
              {lead.status === 'LOST' ? (
                <div className="bg-red-50 border border-red-200 rounded p-4">
                  <div className="text-xs font-semibold text-red-500 mb-1 uppercase tracking-wider">Lead Lost</div>
                  <div className="text-sm text-gray-700">{lead.lost_reason || <span className="italic text-gray-400">No reason recorded</span>}</div>
                  <div className="text-xs text-gray-400 mt-1">Data kept for future reference.</div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-700">Deal Closure Details <span className="text-xs text-gray-400 font-normal">(SOP Step 8)</span></div>
                    {canEdit && <button onClick={() => setShowClosureModal(true)} className="btn btn-secondary btn-sm">Edit</button>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {[
                      ['Billing Name', lead.billing_name],
                      ['GST Number', lead.gst_number],
                      ['Delivery Address', lead.delivery_address],
                    ].map(([label, val]) => (
                      <div key={label as string} className="bg-gray-50 rounded p-3">
                        <div className="text-xs text-gray-400 mb-0.5">{label}</div>
                        <div className="font-medium text-gray-800">{val || <span className="text-gray-300 italic">Not filled</span>}</div>
                      </div>
                    ))}
                  </div>
                  {(!lead.billing_name || !lead.delivery_address) && canEdit && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
                      ⚠ Fill billing name, GST number, and delivery address before sending the Proforma Invoice.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ═══ MODALS ═══ */}

      {/* Change Status */}
      <Modal open={showStatusModal} onClose={() => setShowStatusModal(false)} title="Change Lead Status">
        <div className="space-y-3">
          <div>
            <label className="form-label">New Status</label>
            <select className="form-input" value={newStatus} onChange={e => setNewStatus(e.target.value as LeadStatus)}>
              {STATUS_FLOW.map(s => <option key={s} value={s}>{LEAD_STATUS_CONFIG[s].label}</option>)}
            </select>
          </div>
          {newStatus === 'LOST' && (
            <div>
              <label className="form-label">Reason for Loss</label>
              <select className="form-input mb-2" value={lostReason} onChange={e => setLostReason(e.target.value)}>
                <option value="">— Select reason —</option>
                {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <textarea className="form-input h-16" value={lostReason} onChange={e => setLostReason(e.target.value)} placeholder="Add details…" />
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowStatusModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleStatusChange} className={`btn ${newStatus === 'LOST' ? 'btn-danger' : 'btn-primary'}`}>Update</button>
          </div>
        </div>
      </Modal>

      {/* Log Follow-up */}
      <Modal open={showFollowupModal} onClose={() => setShowFollowupModal(false)} title="Log Follow-up">
        <div className="space-y-3">
          <div>
            <label className="form-label">Contact Mode</label>
            <select className="form-input" value={followupForm.type} onChange={e => setFollowupForm(p => ({ ...p, type: e.target.value }))}>
              {FOLLOWUP_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Notes * <span className="text-gray-400 font-normal">(What was discussed?)</span></label>
            <textarea className="form-input h-20" value={followupForm.notes} onChange={e => setFollowupForm(p => ({ ...p, notes: e.target.value }))} placeholder="Customer said… Next action…" />
          </div>
          <div>
            <label className="form-label">Outcome / Decision</label>
            <input className="form-input" value={followupForm.outcome} onChange={e => setFollowupForm(p => ({ ...p, outcome: e.target.value }))} placeholder="e.g. Interested, needs time. Call back on Day 3." />
          </div>
          <div>
            <label className="form-label">Schedule Next Follow-up</label>
            <input type="datetime-local" className="form-input" value={followupForm.scheduled_at} onChange={e => setFollowupForm(p => ({ ...p, scheduled_at: e.target.value }))} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowFollowupModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleAddFollowup} disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save Follow-up'}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showQuotationModal} onClose={() => { setShowQuotationModal(false); setQuotationStep('form'); setQuotationForm({ amount: '', discount: '', freight_charges: '', installation_charges: '', validity_date: '', payment_terms: '', notes: '' }); setQuotationFile(null); }} title={quotationStep === 'review' ? 'Review Quotation' : 'Create Quotation / PI'} size="lg">
        {quotationStep === 'form' ? (
        <div className="space-y-4">

          {/* ── What we know (read-only summary) ── */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">From Lead</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-gray-400">Customer</span>
                <div className="font-medium text-gray-800">{lead?.customer_name}</div>
                {lead?.company && <div className="text-xs text-gray-500">{lead.company}</div>}
              </div>
              <div>
                <span className="text-xs text-gray-400">Email</span>
                <div className={`font-medium ${lead?.customer_email ? 'text-gray-800' : 'text-amber-500 italic'}`}>
                  {lead?.customer_email || 'No email on file'}
                </div>
              </div>
              {lead?.location && (
                <div>
                  <span className="text-xs text-gray-400">Location</span>
                  <div className="text-gray-700">{lead.location}</div>
                </div>
              )}
              {lead?.quantity && (
                <div>
                  <span className="text-xs text-gray-400">Quantity</span>
                  <div className="text-gray-700">{lead.quantity} unit{parseInt(lead.quantity) !== 1 ? 's' : ''}</div>
                </div>
              )}
            </div>
            {lead?.product_interest && (
              <div>
                <span className="text-xs text-gray-400">Products</span>
                <div className="text-gray-800 font-medium">{lead.product_interest}</div>
              </div>
            )}
            {lead?.customization_notes && (
              <div className="text-xs text-gray-500 italic border-t pt-1.5 mt-1">Custom: {lead.customization_notes}</div>
            )}
          </div>

          {/* ── Only ask for what's missing ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Sub-total Amount (₹) *</label>
              <input type="number" className="form-input" value={quotationForm.amount}
                onChange={e => setQuotationForm(p => ({ ...p, amount: e.target.value }))}
                placeholder="Auto-filled if cart was used" />
              {lead?.estimated_value && !quotationForm.amount && (
                <p className="text-xs text-blue-500 mt-0.5">Suggested: ₹{Math.round(lead.estimated_value / 1.18).toLocaleString('en-IN')}</p>
              )}
            </div>
            <div>
              <label className="form-label">Discount (₹) <span className="text-gray-400 font-normal">optional</span></label>
              <input type="number" className="form-input" value={quotationForm.discount}
                onChange={e => setQuotationForm(p => ({ ...p, discount: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <label className="form-label">Freight Charges (₹) <span className="text-gray-400 font-normal">optional</span></label>
              <input type="number" className="form-input" value={quotationForm.freight_charges}
                onChange={e => setQuotationForm(p => ({ ...p, freight_charges: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <label className="form-label">Installation Charges (₹) <span className="text-gray-400 font-normal">optional</span></label>
              <input type="number" className="form-input" value={quotationForm.installation_charges}
                onChange={e => setQuotationForm(p => ({ ...p, installation_charges: e.target.value }))} placeholder="0" />
            </div>
          </div>

          {/* Live price breakdown */}
          {quotationForm.amount && (() => {
            const sub = parseFloat(quotationForm.amount) || 0;
            const disc = parseFloat(quotationForm.discount) || 0;
            const freight = parseFloat(quotationForm.freight_charges) || 0;
            const install = parseFloat(quotationForm.installation_charges) || 0;
            const subTotalExcl = sub + freight + install;
            const taxableBase  = (sub - disc) + freight + install;
            const totalGst     = Math.round(taxableBase * 0.18);
            const total        = taxableBase + totalGst;
            return (
              <div className="bg-blue-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between text-gray-600"><span>Sub Total (excl. GST)</span><span>₹{subTotalExcl.toLocaleString('en-IN')}</span></div>
                {disc > 0 && <div className="flex justify-between text-red-500"><span>Less: Discount</span><span>− ₹{disc.toLocaleString('en-IN')}</span></div>}
                <div className="flex justify-between text-gray-600"><span>Total GST (18%)</span><span>₹{totalGst.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between font-bold text-blue-700 text-base border-t border-blue-200 pt-1">
                  <span>Grand Total (incl. 18% GST)</span><span>₹{total.toLocaleString('en-IN')}</span>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Validity Date</label>
              <input type="date" className="form-input" value={quotationForm.validity_date}
                onChange={e => setQuotationForm(p => ({ ...p, validity_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Payment Terms</label>
              <select className="form-select" value={quotationForm.payment_terms}
                onChange={e => setQuotationForm(p => ({ ...p, payment_terms: e.target.value }))}>
                <option value="">— Select —</option>
                <option value="50% advance, 50% on delivery">50% advance, 50% on delivery</option>
                <option value="100% advance">100% advance</option>
                <option value="100% on delivery">100% on delivery</option>
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Notes <span className="text-gray-400 font-normal">optional</span></label>
            <textarea className="form-input h-14" value={quotationForm.notes}
              onChange={e => setQuotationForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="Special instructions, next steps…" />
          </div>

          <div>
            <label className="form-label">Attach PDF / File <span className="text-gray-400 font-normal">optional</span></label>
            <input type="file" accept=".pdf,.doc,.docx" className="form-input"
              onChange={e => setQuotationFile(e.target.files?.[0] || null)} />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button onClick={() => { setShowQuotationModal(false); setQuotationStep('form'); setQuotationForm({ amount: '', discount: '', freight_charges: '', installation_charges: '', validity_date: '', payment_terms: '', notes: '' }); setQuotationFile(null); }} className="btn btn-secondary">Cancel</button>
            <button
              disabled={!quotationForm.amount}
              onClick={async () => {
                try {
                  const res = await api.get('/quotations/next-pi');
                  setPreviewPiNumber(res.data.pi_number);
                } catch { setPreviewPiNumber(''); }
                setQuotationStep('review');
              }}
              className="btn btn-primary"
            >
              Review Quotation →
            </button>
          </div>
        </div>
        ) : (
        /* ── STEP 2: REVIEW ── */
        (() => {
          const sub      = parseFloat(quotationForm.amount) || 0;
          const disc     = parseFloat(quotationForm.discount) || 0;
          const freight  = parseFloat(quotationForm.freight_charges) || 0;
          const install  = parseFloat(quotationForm.installation_charges) || 0;
          const afterDisc   = sub - disc;
          const subTotalExcl = sub + freight + install;
          const taxableBase  = afterDisc + freight + install;
          const totalGst     = Math.round(taxableBase * 0.18);
          const total        = taxableBase + totalGst;
          const co       = companyInfo || {};
          const fmt      = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const fmtI     = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
          const fmtDate  = (d: string) => parseIST(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

          // Parse product items and match to actual base_price
          const parsedItems = (lead?.product_interest || '').split(',').map(p => {
            const mFull = p.trim().match(/^(\d+)x\s+(.+?)\s*\(([^)]+)\)/); // "1x Name (MODEL)"
            const mSimp = p.trim().match(/^(\d+)x\s+(.+)/);                // "1x Name"
            const qty       = mFull ? parseInt(mFull[1]) : mSimp ? parseInt(mSimp[1]) : 1;
            const shortName = mFull ? mFull[2].trim() : mSimp ? mSimp[2].trim() : p.trim();
            const modelCode = mFull ? mFull[3].trim() : '';
            const fullName  = mFull ? `${shortName} (${modelCode})` : shortName;
            const prod = products.find(pr =>
              (modelCode && pr.model_code === modelCode) ||
              pr.name.toLowerCase().includes(shortName.toLowerCase()) ||
              shortName.toLowerCase().includes(pr.name.toLowerCase())
            );
            const basePrice = prod?.base_price ? Number(prod.base_price) : null;
            const hsn = prod?.hsn_sac_code || '841900'; // fallback HSN
            return { qty, name: fullName, shortName, modelCode, basePrice, hsn };
          }).filter(i => i.name);

          // Per-item amounts: use actual base_price when available, else distribute sub equally
          const totalQty   = parsedItems.reduce((s, i) => s + i.qty, 0) || 1;
          const allKnown   = parsedItems.length > 0 && parsedItems.every(i => i.basePrice !== null);
          const fallback   = Math.round(sub / totalQty);
          const items = parsedItems.map(i => {
            const rate    = allKnown ? (i.basePrice as number) : fallback;
            const amt     = rate * i.qty;
            const inclGst = Math.round(amt * 1.18);
            return { ...i, rate, amt, inclGst };
          });

          const hasBank = co.bankAccount && !co.bankAccount.startsWith('X');

          return (
            <div className="space-y-3">
              {/* ── Invoice Preview ── */}
              <div className="border border-gray-300 rounded overflow-hidden text-xs" ref={piPreviewRef} style={{ fontFamily: 'Arial, sans-serif' }}>

                {/* Company Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b-2 border-yellow-600">
                  <img src="/data/logo.png" alt="Logo" className="h-14 w-auto object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <div className="text-right">
                    <div className="text-base font-bold text-gray-900">{co.name || 'Lyra Enterprises'}</div>
                    {co.address && <div className="text-gray-500">{co.address}</div>}
                    {co.city    && <div className="text-gray-500">{co.city}</div>}
                    {co.gstin   && <div className="text-gray-500">GSTIN {co.gstin}</div>}
                    {co.phone   && <div className="text-gray-500">{co.phone}</div>}
                    {co.email   && <div className="text-gray-500">{co.email}</div>}
                  </div>
                </div>

                {/* Title */}
                <div className="text-center py-2 border-b border-gray-200 font-bold tracking-widest text-gray-700">QUOTATION / PROFORMA INVOICE</div>

                {/* Bill To / Ship To / PI Details */}
                <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <div className="p-3 border-r border-gray-200">
                    <div className="text-yellow-700 font-bold uppercase mb-1" style={{ fontSize: '10px' }}>Bill To</div>
                    <div className="font-bold text-gray-900">{lead?.billing_name || lead?.customer_name}</div>
                    {lead?.company && <div className="text-gray-500">{lead.company}</div>}
                    {lead?.location && <div className="text-gray-500 mt-0.5">{lead.location}</div>}
                    {lead?.customer_phone && <div className="text-gray-500">Phone {lead.customer_phone}</div>}
                  </div>
                  <div className="p-3 border-r border-gray-200">
                    <div className="text-yellow-700 font-bold uppercase mb-1" style={{ fontSize: '10px' }}>Ship To</div>
                    <div className="text-gray-500">
                      {lead?.delivery_address || lead?.location || <span className="italic text-gray-300">Same as billing</span>}
                    </div>
                  </div>
                  <div className="p-3">
                    <table className="w-full">
                      <tbody>
                        <tr><td className="text-gray-400 pr-2 pb-0.5">Quotation No</td><td className="font-semibold text-gray-700">{previewPiNumber || 'Auto on save'}</td></tr>
                        <tr><td className="text-gray-400 pr-2 pb-0.5">Date</td><td>{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</td></tr>
                        {quotationForm.validity_date && <tr><td className="text-gray-400 pr-2 pb-0.5">Valid Until</td><td className="font-semibold">{fmtDate(quotationForm.validity_date)}</td></tr>}
                        {quotationForm.payment_terms && <tr><td className="text-gray-400 pr-2 pb-0.5">Terms</td><td>{quotationForm.payment_terms}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Products Table */}
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      <th className="p-2 text-center w-6">S.No</th>
                      <th className="p-2 text-left">Item</th>
                      <th className="p-2 text-left">Description</th>
                      <th className="p-2 text-center w-16">HSN/SAC</th>
                      <th className="p-2 text-center">Qty</th>
                      <th className="p-2 text-right">Rate (excl. GST)</th>
                      <th className="p-2 text-right">Amt (excl. GST)</th>
                      <th className="p-2 text-right">Amt (incl. GST)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                        <tr key={i} className={`border-b border-gray-100 ${i%2===1?'bg-gray-50':''}`}>
                          <td className="p-2 text-center">{i+1}</td>
                          <td className="p-2 font-semibold text-gray-800">{item.name}</td>
                          <td className="p-2 text-gray-500">{item.shortName || item.name}</td>
                          <td className="p-2 text-center text-gray-600 text-sm">{item.hsn}</td>
                          <td className="p-2 text-center">{item.qty}.00<br/><span className="text-gray-400" style={{fontSize:'9px'}}>nos</span></td>
                          <td className="p-2 text-right">{fmtI(item.rate)}</td>
                          <td className="p-2 text-right">{fmt(item.amt)}</td>
                          <td className="p-2 text-right font-semibold">{fmt(item.inclGst)}</td>
                        </tr>
                    ))}
                    {freight > 0 && (
                      <tr className="border-b border-gray-100">
                        <td className="p-2 text-center">{items.length + 1}</td>
                        <td className="p-2 font-semibold text-gray-800">Freight Charges</td>
                        <td className="p-2 text-gray-500">Logistics &amp; Transportation</td>
                        <td className="p-2 text-center text-gray-600 text-sm">996511</td>
                        <td className="p-2 text-center">1.00<br/><span className="text-gray-400" style={{fontSize:'9px'}}>lump</span></td>
                        <td className="p-2 text-right">{fmtI(freight)}</td>
                        <td className="p-2 text-right">{fmt(freight)}</td>
                        <td className="p-2 text-right font-semibold">{fmt(Math.round(freight * 1.18))}</td>
                      </tr>
                    )}
                    {install > 0 && (
                      <tr className="border-b border-gray-100">
                        <td className="p-2 text-center">{items.length + (freight > 0 ? 2 : 1)}</td>
                        <td className="p-2 font-semibold text-gray-800">Installation Charges</td>
                        <td className="p-2 text-gray-500">Setup &amp; Commissioning</td>
                        <td className="p-2 text-center text-gray-600 text-sm">998721</td>
                        <td className="p-2 text-center">1.00<br/><span className="text-gray-400" style={{fontSize:'9px'}}>lump</span></td>
                        <td className="p-2 text-right">{fmtI(install)}</td>
                        <td className="p-2 text-right">{fmt(install)}</td>
                        <td className="p-2 text-right font-semibold">{fmt(Math.round(install * 1.18))}</td>
                      </tr>
                    )}
                    {quotationForm.notes && (
                      <tr><td colSpan={8} className="p-2 text-gray-500 border-t border-gray-100"><strong>Note:</strong> {quotationForm.notes}</td></tr>
                    )}
                  </tbody>
                </table>

                {/* Totals */}
                <table className="w-full border-collapse border-t-2 border-gray-300">
                  <tbody>
                    <tr><td colSpan={7} className="p-1.5 text-right text-gray-500">Sub Total (excl. GST)</td><td className="p-1.5 text-right w-24">{fmt(subTotalExcl)}</td></tr>
                    {disc > 0 && <tr><td colSpan={7} className="p-1.5 text-right text-red-500">Less: Discount</td><td className="p-1.5 text-right text-red-500">− {fmt(disc)}</td></tr>}
                    <tr><td colSpan={7} className="p-1.5 text-right text-gray-500">Total GST (18%)</td><td className="p-1.5 text-right">{fmt(totalGst)}</td></tr>
                    <tr className="bg-gray-50 border-t-2 border-gray-700">
                      <td colSpan={7} className="p-2 text-right font-bold text-sm">Grand Total (incl. 18% GST)</td>
                      <td className="p-2 text-right font-bold text-sm">{fmt(total)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Total in words */}
                <div className="px-3 py-2 border-t border-gray-200 text-gray-700">
                  <strong>Total In Words: </strong><em>{numberToWords(total)}</em>
                </div>

                {/* Freight note – only shown when neither is included */}
                {freight === 0 && install === 0 && (
                  <div className="px-3 pb-2 italic text-gray-400 border-b border-gray-200">
                    * Freight &amp; Installation charges are extra and will be quoted separately.
                  </div>
                )}

                {/* Bank Details + QR */}
                {co.bankAccount && (
                  <div className="px-3 py-3 border-t border-gray-200 bg-gray-50">
                    <div className="font-bold text-gray-700 mb-2 text-xs uppercase tracking-wide">Bank Details — Payment Information</div>
                    <div className="flex gap-4 items-start">
                      <div className="text-gray-600 leading-6 text-xs flex-1">
                        <div><span className="text-gray-400 inline-block" style={{minWidth:'7rem'}}>Company Name</span>{co.bankCompany}</div>
                        {co.bankName    && <div><span className="text-gray-400 inline-block" style={{minWidth:'7rem'}}>Bank</span>{co.bankName}</div>}
                        {co.bankAccount && <div><span className="text-gray-400 inline-block" style={{minWidth:'7rem'}}>Account No</span><strong className="text-gray-900">{co.bankAccount}</strong></div>}
                        {co.bankIfsc    && <div><span className="text-gray-400 inline-block" style={{minWidth:'7rem'}}>IFSC Code</span>{co.bankIfsc}</div>}
                        {co.bankBranch  && <div><span className="text-gray-400 inline-block" style={{minWidth:'7rem'}}>Branch</span>{co.bankBranch}</div>}
                        {co.bankUpi     && <div><span className="text-gray-400 inline-block" style={{minWidth:'7rem'}}>UPI ID</span><strong className="text-gray-900">{co.bankUpi}</strong></div>}
                      </div>
                      <div className="text-center shrink-0">
                        <img src="/data/payment-qr.png"
                          alt="Scan to Pay"
                          className="w-24 h-24 border border-gray-300 rounded"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        <div className="text-gray-400 text-xs mt-1">Scan to Pay</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Email recipient notice */}
                <div className={`px-3 py-2 border-t border-gray-100 ${lead?.customer_email ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>
                  {lead?.customer_email ? <>✉ Will be emailed to <strong>{lead.customer_email}</strong></> : <>⚠ No email on file – will be saved only</>}
                </div>
                {quotationFile && <div className="px-3 py-1 text-gray-500">📎 {quotationFile.name}</div>}

              </div>

              {/* Actions */}
              <div className="flex gap-2 justify-end flex-wrap">
                <button onClick={() => setQuotationStep('form')} className="btn btn-secondary">← Edit</button>
                <button onClick={handleDownloadPdf} disabled={downloadingPdf} className="btn btn-secondary">
                  {downloadingPdf ? '⏳ Generating…' : '⬇ Download PDF'}
                </button>
                <button onClick={() => handleUploadQuotation(false)} disabled={saving} className="btn btn-secondary">
                  {saving ? 'Saving…' : 'Save Only'}
                </button>
                <button onClick={() => handleUploadQuotation(true)} disabled={saving || !lead?.customer_email}
                  title={!lead?.customer_email ? 'No email on file' : ''} className="btn btn-primary">
                  {saving ? 'Sending…' : `✉ Send to ${lead?.customer_email || 'customer'}`}
                </button>
              </div>
            </div>
          );
        })()
        )}
      </Modal>

      {/* Edit Requirements modal removed — now inline table */}

      {/* Closure Details */}
      <Modal open={showClosureModal} onClose={() => setShowClosureModal(false)} title="Deal Closure Details">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Collect these before sending the Proforma Invoice (SOP Step 8)</p>
          <div>
            <label className="form-label">Billing Name *</label>
            <input className="form-input" value={closureForm.billing_name} onChange={e => setClosureForm(p => ({ ...p, billing_name: e.target.value }))} placeholder="Legal name for invoice" />
          </div>
          <div>
            <label className="form-label">GST Number</label>
            <input className="form-input" value={closureForm.gst_number} onChange={e => setClosureForm(p => ({ ...p, gst_number: e.target.value }))} placeholder="22AAAAA0000A1Z5" />
          </div>
          <div>
            <label className="form-label">Delivery / Installation Address *</label>
            <textarea className="form-input h-16" value={closureForm.delivery_address} onChange={e => setClosureForm(p => ({ ...p, delivery_address: e.target.value }))} placeholder="Full address with pincode" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowClosureModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleSaveClosure} disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save Details'}</button>
          </div>
        </div>
      </Modal>

      {/* Edit Customer Info */}
      <Modal open={showEditCustomerModal} onClose={() => setShowEditCustomerModal(false)} title="Edit Customer Info">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="form-label">Customer Name *</label>
              <input className="form-input" value={editCustomerForm.customer_name} onChange={e => setEditCustomerForm(p => ({ ...p, customer_name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Phone *</label>
              <input className="form-input" value={editCustomerForm.customer_phone} onChange={e => setEditCustomerForm(p => ({ ...p, customer_phone: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={editCustomerForm.customer_email} onChange={e => setEditCustomerForm(p => ({ ...p, customer_email: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Company</label>
              <input className="form-input" value={editCustomerForm.company} onChange={e => setEditCustomerForm(p => ({ ...p, company: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">City / Location</label>
              <input className="form-input" value={editCustomerForm.location} onChange={e => setEditCustomerForm(p => ({ ...p, location: e.target.value }))} placeholder="City or district" />
            </div>
            <div>
              <label className="form-label">Estimated Value (₹)</label>
              <input type="number" className="form-input" value={editCustomerForm.estimated_value} onChange={e => setEditCustomerForm(p => ({ ...p, estimated_value: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="form-label">Address (Billing / Site)</label>
            <textarea className="form-textarea h-16" placeholder="Street, City, State, PIN" value={editCustomerForm.address} onChange={e => setEditCustomerForm(p => ({ ...p, address: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Delivery / Shipping Address</label>
            <textarea className="form-textarea h-16" placeholder="Leave blank if same as above" value={editCustomerForm.delivery_address} onChange={e => setEditCustomerForm(p => ({ ...p, delivery_address: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Internal Notes</label>
            <textarea className="form-textarea h-14" value={editCustomerForm.notes} onChange={e => setEditCustomerForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowEditCustomerModal(false)} className="btn btn-secondary">Cancel</button>
            <button disabled={saving} onClick={async () => {
              if (!editCustomerForm.customer_name || !editCustomerForm.customer_phone) return toast.error('Name and phone are required');
              setSaving(true);
              try {
                await patch({
                  customer_name: editCustomerForm.customer_name,
                  customer_phone: editCustomerForm.customer_phone,
                  customer_email: editCustomerForm.customer_email || null,
                  company: editCustomerForm.company || null,
                  location: editCustomerForm.location || null,
                  address: editCustomerForm.address || null,
                  delivery_address: editCustomerForm.delivery_address || null,
                  estimated_value: editCustomerForm.estimated_value ? Number(editCustomerForm.estimated_value) : null,
                  notes: editCustomerForm.notes || null,
                });
                toast.success('Customer info updated');
                setShowEditCustomerModal(false);
              } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
              finally { setSaving(false); }
            }} className="btn btn-primary">{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </div>
      </Modal>

      {/* Edit Product & Requirements */}
      <Modal open={showEditProductModal} onClose={() => { setShowEditProductModal(false); setEditProductItems([]); setEditProductPick(''); }} title="Edit Product & Requirements">
        {(() => {
          const epSubtotal = editProductItems.reduce((s, i) => s + (i.product.base_price || 0) * i.qty, 0);
          const epGst = Math.round(epSubtotal * 0.18);
          const epTotal = epSubtotal + epGst;
          const epQty = editProductItems.reduce((s, i) => s + i.qty, 0);
          return (
            <div className="space-y-4">
              {/* Catalog picker */}
              {products.length > 0 && (
                <div className="space-y-2">
                  <label className="form-label">Add from Catalog (optional — replaces text below)</label>
                  <div className="flex gap-2">
                    <select className="form-input flex-1" value={editProductPick} onChange={e => setEditProductPick(e.target.value)}>
                      <option value="">— Select product —</option>
                      {productTypes.map(type => (
                        <optgroup key={type} label={type}>
                          {products.filter(p => p.product_type === type).map(p => (
                            <option key={p.id} value={p.id}>{p.name}{p.model_code ? ` — ${p.model_code}` : ''}{p.base_price ? ` (₹${p.base_price.toLocaleString('en-IN')})` : ''}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button type="button" disabled={!editProductPick} className="btn btn-secondary btn-sm px-3 shrink-0" onClick={() => {
                      const product = products.find(p => p.id === editProductPick);
                      if (!product) return;
                      setEditProductItems(prev => {
                        const ex = prev.find(i => i.product.id === product.id);
                        const updated = ex ? prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i) : [...prev, { product, qty: 1 }];
                        const lines = updated.map(i => `${i.qty}x ${i.product.name}${i.product.model_code ? ` (${i.product.model_code})` : ''}`);
                        const types = [...new Set(updated.map(i => i.product.product_type))];
                        const qty = updated.reduce((s, i) => s + i.qty, 0);
                        const st  = updated.reduce((s, i) => s + (i.product.base_price || 0) * i.qty, 0);
                        const tot = st + Math.round(st * 0.18);
                        setEditProductForm(p => ({ ...p, product_interest: lines.join(', '), product_type: types.join(', '), quantity: String(qty), estimated_value: tot > 0 ? String(tot) : p.estimated_value }));
                        return updated;
                      });
                      setEditProductPick('');
                    }}>+ Add</button>
                  </div>
                  {editProductItems.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden text-sm">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b"><tr>
                          <th className="text-left px-3 py-1.5 text-xs text-gray-500">Product</th>
                          <th className="text-center px-2 py-1.5 text-xs text-gray-500 w-24">Qty</th>
                          <th className="text-right px-3 py-1.5 text-xs text-gray-500">Amount</th>
                          <th className="w-6"></th>
                        </tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {editProductItems.map(({ product, qty }) => (
                            <tr key={product.id}>
                              <td className="px-3 py-1.5">
                                <div className="font-medium">{product.name}</div>
                                {product.model_code && <div className="text-xs text-gray-400 font-mono">{product.model_code}</div>}
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center justify-center gap-1">
                                  <button type="button" onClick={() => {
                                    const updated = qty <= 1 ? editProductItems.filter(i => i.product.id !== product.id) : editProductItems.map(i => i.product.id === product.id ? { ...i, qty: i.qty - 1 } : i);
                                    const lines = updated.map(i => `${i.qty}x ${i.product.name}${i.product.model_code ? ` (${i.product.model_code})` : ''}`);
                                    const types = [...new Set(updated.map(i => i.product.product_type))];
                                    const q = updated.reduce((s, i) => s + i.qty, 0);
                                    const st = updated.reduce((s, i) => s + (i.product.base_price || 0) * i.qty, 0);
                                    const tot = st + Math.round(st * 0.18);
                                    setEditProductForm(p => ({ ...p, product_interest: lines.join(', '), product_type: types.join(', '), quantity: String(q), estimated_value: tot > 0 ? String(tot) : p.estimated_value }));
                                    setEditProductItems(updated);
                                  }} className="w-5 h-5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">−</button>
                                  <span className="w-6 text-center">{qty}</span>
                                  <button type="button" onClick={() => {
                                    const updated = editProductItems.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i);
                                    const lines = updated.map(i => `${i.qty}x ${i.product.name}${i.product.model_code ? ` (${i.product.model_code})` : ''}`);
                                    const types = [...new Set(updated.map(i => i.product.product_type))];
                                    const q = updated.reduce((s, i) => s + i.qty, 0);
                                    const st = updated.reduce((s, i) => s + (i.product.base_price || 0) * i.qty, 0);
                                    const tot = st + Math.round(st * 0.18);
                                    setEditProductForm(p => ({ ...p, product_interest: lines.join(', '), product_type: types.join(', '), quantity: String(q), estimated_value: tot > 0 ? String(tot) : p.estimated_value }));
                                    setEditProductItems(updated);
                                  }} className="w-5 h-5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-xs font-bold">+</button>
                                </div>
                              </td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{product.base_price ? `₹${((product.base_price || 0) * qty).toLocaleString('en-IN')}` : '—'}</td>
                              <td className="px-1 py-1.5"><button type="button" onClick={() => {
                                const updated = editProductItems.filter(i => i.product.id !== product.id);
                                const lines = updated.map(i => `${i.qty}x ${i.product.name}${i.product.model_code ? ` (${i.product.model_code})` : ''}`);
                                const types = [...new Set(updated.map(i => i.product.product_type))];
                                const q = updated.reduce((s, i) => s + i.qty, 0);
                                setEditProductForm(p => ({ ...p, product_interest: lines.join(', '), product_type: types.join(', '), quantity: String(q) }));
                                setEditProductItems(updated);
                              }} className="text-gray-300 hover:text-red-500 text-base leading-none">×</button></td>
                            </tr>
                          ))}
                        </tbody>
                        {epSubtotal > 0 && (
                          <tfoot className="bg-gray-50 border-t text-xs">
                            <tr><td colSpan={2} className="px-3 py-1 text-right text-gray-500">Subtotal ({epQty} unit{epQty !== 1 ? 's' : ''})</td><td className="px-3 py-1 text-right font-semibold">₹{epSubtotal.toLocaleString('en-IN')}</td><td></td></tr>
                            <tr><td colSpan={2} className="px-3 py-1 text-right text-blue-500">GST 18%</td><td className="px-3 py-1 text-right text-blue-600">+ ₹{epGst.toLocaleString('en-IN')}</td><td></td></tr>
                            <tr className="border-t"><td colSpan={2} className="px-3 py-1.5 text-right font-bold text-gray-700">Total (incl. GST)</td><td className="px-3 py-1.5 text-right font-bold text-emerald-600">₹{epTotal.toLocaleString('en-IN')}</td><td></td></tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Product interest text */}
              <div>
                <label className="form-label">Product Interest *</label>
                <textarea className="form-textarea h-16" value={editProductForm.product_interest} onChange={e => setEditProductForm(p => ({ ...p, product_interest: e.target.value }))} placeholder="e.g. 2x Push Button Vending Machine (Lyra/SNVM/PB)" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Product Type</label>
                  <input className="form-input" value={editProductForm.product_type} onChange={e => setEditProductForm(p => ({ ...p, product_type: e.target.value }))} placeholder="e.g. Vending Machine" />
                </div>
                <div>
                  <label className="form-label">Quantity</label>
                  <input className="form-input" value={editProductForm.quantity} onChange={e => setEditProductForm(p => ({ ...p, quantity: e.target.value }))} placeholder="e.g. 2" />
                </div>
                <div>
                  <label className="form-label">Purchase Timeline</label>
                  <input type="date" className="form-input"
                    value={editProductForm.purchase_timeline ? (() => { try { const d = new Date(editProductForm.purchase_timeline); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }); } catch { return ''; } })() : ''}
                    onChange={e => {
                      if (!e.target.value) { setEditProductForm(p => ({ ...p, purchase_timeline: '' })); return; }
                      const d = new Date(e.target.value);
                      setEditProductForm(p => ({ ...p, purchase_timeline: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) }));
                    }}
                  />
                </div>
                <div>
                  <label className="form-label">Budget Range</label>
                  <select className="form-input" value={editProductForm.budget_range} onChange={e => setEditProductForm(p => ({ ...p, budget_range: e.target.value }))}>
                    <option value="">— Select —</option>
                    {['₹15,000 – ₹30,000','₹30,000 – ₹50,000','₹50,000 – ₹1 Lakh','₹1L – ₹2L','₹2L – ₹5L','₹5L – ₹10L','₹10L – ₹25L','₹25L – ₹50L','₹50L – ₹1 Crore','Above ₹1 Crore'].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Solution Type</label>
                  <select className="form-input" value={editProductForm.requirement_type} onChange={e => setEditProductForm(p => ({ ...p, requirement_type: e.target.value }))}>
                    <option value="standard">Standard Model</option>
                    <option value="custom">Customised Solution</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Estimated Value (₹)</label>
                  <input type="number" className="form-input" value={editProductForm.estimated_value} onChange={e => setEditProductForm(p => ({ ...p, estimated_value: e.target.value }))} placeholder="Auto-calculated from catalog" />
                </div>
              </div>

              <div>
                <label className="form-label">Customisation Requirements</label>
                <textarea className="form-textarea h-16" value={editProductForm.customization_notes} onChange={e => setEditProductForm(p => ({ ...p, customization_notes: e.target.value }))} placeholder="Special features, branding, size requirements…" />
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="req_confirmed" checked={!!editProductForm.requirement_confirmed}
                  onChange={e => setEditProductForm(p => ({ ...p, requirement_confirmed: e.target.checked ? 1 : 0 }))} className="rounded" />
                <label htmlFor="req_confirmed" className="text-sm text-gray-700">Mark requirements as confirmed</label>
              </div>

              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowEditProductModal(false); setEditProductItems([]); setEditProductPick(''); }} className="btn btn-secondary">Cancel</button>
                <button disabled={saving || !editProductForm.product_interest.trim()} onClick={async () => {
                  if (!editProductForm.product_interest.trim()) return toast.error('Product interest is required');
                  setSaving(true);
                  try {
                    await patch({
                      product_interest: editProductForm.product_interest,
                      product_type: editProductForm.product_type || null,
                      quantity: editProductForm.quantity || null,
                      purchase_timeline: editProductForm.purchase_timeline || null,
                      budget_range: editProductForm.budget_range || null,
                      customization_notes: editProductForm.customization_notes || null,
                      requirement_type: editProductForm.requirement_type,
                      requirement_confirmed: editProductForm.requirement_confirmed,
                      estimated_value: editProductForm.estimated_value ? Number(editProductForm.estimated_value) : null,
                    });
                    toast.success('Product info updated');
                    setShowEditProductModal(false);
                    setEditProductItems([]);
                    setEditProductPick('');
                  } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
                  finally { setSaving(false); }
                }} className="btn btn-primary">{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Create Production Order */}
      <Modal open={showProductionModal} onClose={() => setShowProductionModal(false)} title="Create Production Order">
        <div className="space-y-3">
          <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-700">
            ✓ Payment confirmed. Creating a production order for <strong>{lead.customer_name}</strong>.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Expected Delivery Date</label>
              <input type="date" className="form-input" value={productionForm.expected_delivery_date} onChange={e => setProductionForm(p => ({ ...p, expected_delivery_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Priority</label>
              <select className="form-input" value={productionForm.priority} onChange={e => setProductionForm(p => ({ ...p, priority: e.target.value }))}>
                {['LOW','NORMAL','HIGH','URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Notes for Production</label>
            <textarea className="form-input h-16" value={productionForm.notes} onChange={e => setProductionForm(p => ({ ...p, notes: e.target.value }))} placeholder="Special instructions, customisation details…" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowProductionModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleCreateProduction} disabled={saving} className="btn btn-success">{saving ? 'Creating…' : '🏭 Create Order'}</button>
          </div>
        </div>
      </Modal>

      {/* ════ PAYMENT CONFIRMATION MODAL ════ */}
      <Modal open={!!paymentModal} onClose={() => setPaymentModal(null)} title="Confirm Payment">
        <div className="space-y-4">
          {paymentModal && (
            <div className="text-sm text-gray-500 bg-gray-50 rounded p-3">
              Grand Total: <span className="font-bold text-gray-900">{formatCurrency(paymentModal.grandTotal)}</span>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Payment Type</label>
            <div className="flex gap-3">
              <button
                onClick={() => setPayType('full')}
                className={`flex-1 py-2 px-3 rounded border text-sm font-semibold transition-colors ${
                  payType === 'full' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                }`}
              >✓ Full Payment</button>
              <button
                onClick={() => setPayType('partial')}
                className={`flex-1 py-2 px-3 rounded border text-sm font-semibold transition-colors ${
                  payType === 'partial' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400'
                }`}
              >⏳ Partial Payment</button>
            </div>
          </div>
          {payType === 'partial' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Amount Paid (₹)</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="Enter amount received"
                  value={payAmountInput}
                  onChange={e => setPayAmountInput(e.target.value)}
                />
              </div>
              {paymentModal && parseFloat(payAmountInput) > 0 && (
                <div className="flex justify-between text-sm bg-orange-50 border border-orange-200 rounded p-3">
                  <span className="text-green-600 font-semibold">Paid: {formatCurrency(parseFloat(payAmountInput))}</span>
                  <span className="text-orange-500 font-semibold">Remaining: {formatCurrency(paymentModal.grandTotal - parseFloat(payAmountInput))}</span>
                </div>
              )}
            </div>
          )}
          {payType === 'full' && (
            <p className="text-xs text-gray-500">This will mark the quotation as fully paid and unlock production order creation.</p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPaymentModal(null)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleSubmitPayment} disabled={saving} className={`btn ${payType === 'full' ? 'btn-success' : 'btn-warning'}`}>
              {saving ? 'Saving…' : payType === 'full' ? '✓ Confirm Full Payment' : '⏳ Record Partial Payment'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}

