import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { Upload, Mail, MessageCircle, Phone, Plus, Pencil, Trash2, CheckSquare, Square, Send, X, ChevronDown, UserPlus, MessageSquare, Search, ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react';
import api from '../../utils/api';
import Modal from '../../components/Modal';

/* ─── Types ───────────────────────────────────────────── */
interface Contact {
  id: string;
  map: string;
  name: string;
  organization: string;
  place: string;
  contact: string;
  website: string;
  whatsapp: string;
  email: string;
  emails_sent: number;
  wa_opened: number;
  status: 'none' | 'contacted' | 'possible_buyer' | 'wont_buy' | 'other';
  comment: string;
  emailStatus?: 'idle' | 'sending' | 'sent' | 'failed';
  waStatus?: 'idle' | 'opened';
}

const STATUS_OPTIONS: { value: Contact['status']; label: string; cls: string; dot: string }[] = [
  { value: 'none',          label: "Haven't Contacted", cls: 'text-gray-500 bg-gray-100 border-gray-200',    dot: 'bg-gray-400' },
  { value: 'contacted',     label: 'Contacted',          cls: 'text-blue-600 bg-blue-50 border-blue-200',    dot: 'bg-blue-500' },
  { value: 'possible_buyer',label: 'Possible Buyer',     cls: 'text-green-700 bg-green-50 border-green-200', dot: 'bg-green-500' },
  { value: 'wont_buy',      label: "Won't Buy",          cls: 'text-red-500 bg-red-50 border-red-200',       dot: 'bg-red-400'  },
  { value: 'other',         label: 'Other',              cls: 'text-amber-600 bg-amber-50 border-amber-200', dot: 'bg-amber-400'},
];
function statusMeta(v: Contact['status']) { return STATUS_OPTIONS.find(s => s.value === v) ?? STATUS_OPTIONS[0]; }

interface Template {
  id: string;
  name: string;
  type: 'email' | 'whatsapp';
  format?: 'html' | 'plain';
  subject?: string;
  body: string;
}

/* ─── Helpers ─────────────────────────────────────────── */
function applyVars(text: string, c: Contact): string {
  return text
    .replace(/\{name\}/gi, c.name || '')
    .replace(/\{organization\}/gi, c.organization || '')
    .replace(/\{place\}/gi, c.place || '')
    .replace(/\{contact\}/gi, c.contact || '')
    .replace(/\{website\}/gi, c.website || '')
    .replace(/\{whatsapp\}/gi, c.whatsapp || '');
}

function normalizePhone(raw: string): string {
  // strip non-digits, remove leading 0, ensure 91 prefix for India
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('91') && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/* ─── Duplicate check helper ─────────────────────────── */
function isDuplicateContact(existing: Contact[], contact: string, email: string): boolean {
  const norm = (s: string) => String(s || '').replace(/\D/g, '');
  const phone = norm(contact);
  const mail = (email || '').toLowerCase().trim();
  return existing.some(c =>
    (phone && norm(c.contact) === phone) ||
    (mail && (c.email || '').toLowerCase().trim() === mail)
  );
}

/* ─── Sample Excel download ───────────────────────────── */
function downloadSample() {
  const sample = [
    { 'Google Map': 'https://maps.app.goo.gl/example1', 'Name': 'John Doe', 'Organization': 'Acme Corp', 'Place Type': 'Retail', 'Contact No': '9876543210', 'Email': 'john@acme.com', 'Website': 'www.acme.com', 'WhatsApp Number': '9876543210' },
    { 'Google Map': 'https://maps.app.goo.gl/example2', 'Name': 'Jane Smith', 'Organization': 'Beta Ltd', 'Place Type': 'Hospital', 'Contact No': '9123456789', 'Email': 'jane@beta.com', 'Website': 'www.beta.com', 'WhatsApp Number': '' },
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
  XLSX.writeFile(wb, 'sayhi_sample.xlsx');
}

/* ─── Column auto-detect ──────────────────────────────── */
function mapRow(row: Record<string, unknown>): Partial<Contact> {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase().trim()] = String(v ?? '');

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (lower[k]) return lower[k];
      const found = Object.keys(lower).find(x => x.includes(k));
      if (found) return lower[found];
    }
    return '';
  };

  return {
    map: pick('google map', 'map', 'location link', 'maps'),
    name: pick('name', 'business name', 'company name', 'customer name', 'contact name'),
    organization: pick('organization', 'org', 'company', 'firm', 'business'),
    place: pick('place type', 'place', 'city', 'area', 'address', 'location'),
    contact: pick('contact no', 'contact', 'phone', 'mobile', 'number', 'phone no'),
    website: pick('website', 'web', 'url', 'site'),
    whatsapp: pick('whatsapp number', 'whatsapp no', 'whatsapp', 'wa', 'wa no'),
    email: pick('email', 'email id', 'mail', 'e-mail'),
  };
}

/* ─── Row add / edit modal (own state to avoid stale closure) ─── */
interface RowModalProps {
  open: boolean;
  initial: Partial<Contact>;
  onSave: (data: Omit<Contact, 'id' | 'emailStatus' | 'waStatus' | 'emails_sent' | 'wa_opened'>) => void;
  onClose: () => void;
}
function RowModal({ open, initial, onSave, onClose }: RowModalProps) {
  const [form, setForm] = useState({
    name: initial.name || '',
    organization: initial.organization || '',
    place: initial.place || '',
    contact: initial.contact || '',
    email: initial.email || '',
    website: initial.website || '',
    whatsapp: initial.whatsapp || '',
    map: initial.map || '',
    status: (initial.status as Contact['status']) || 'none',
    comment: initial.comment || '',
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSave = () => {
    if (!form.name && !form.contact && !form.email) {
      toast.error('Enter at least a name, contact, or email');
      return;
    }
    onSave(form);
  };

  const isEdit = !!initial.id;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Contact' : 'Add Contact'} size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Name</label>
            <input className="form-input" value={form.name} onChange={set('name')} placeholder="Person name" autoFocus />
          </div>
          <div>
            <label className="form-label">Organization</label>
            <input className="form-input" value={form.organization} onChange={set('organization')} placeholder="Company / Business name" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Place Type</label>
            <input className="form-input" value={form.place} onChange={set('place')} placeholder="e.g. Retail, Hospital, Office" />
          </div>
          <div>
            <label className="form-label">Contact No.</label>
            <input className="form-input" value={form.contact} onChange={set('contact')} placeholder="+91 XXXXXXXXXX" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">WhatsApp No.</label>
            <input className="form-input" value={form.whatsapp} onChange={set('whatsapp')} placeholder="Leave blank to use Contact No." />
          </div>
        </div>
        <div>
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={form.email} onChange={set('email')} placeholder="contact@example.com" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Website</label>
            <input className="form-input" value={form.website} onChange={set('website')} placeholder="www.example.com" />
          </div>
          <div>
            <label className="form-label">Google Map Link</label>
            <input className="form-input" value={form.map} onChange={set('map')} placeholder="https://maps.app.goo.gl/..." />
          </div>
        </div>
        <div>
          <label className="form-label">Status</label>
          <select className="form-select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as Contact['status'] }))}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Comment / Notes</label>
          <textarea className="form-input resize-none" rows={3} value={form.comment} onChange={e => setForm(p => ({ ...p, comment: e.target.value }))} placeholder="Add any notes about this contact..." />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn btn-primary flex items-center gap-1">
            <Plus size={14} /> {isEdit ? 'Save Changes' : 'Add Contact'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════ */
export default function SayHi() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [activeEmailTpl, setActiveEmailTpl] = useState<Template | null>(null);
  const [activeWaTpl, setActiveWaTpl] = useState<Template | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTpl, setEditingTpl] = useState<Partial<Template> | null>(null);
  const [tplForm, setTplForm] = useState({ name: '', type: 'email' as 'email' | 'whatsapp', format: 'plain' as 'html' | 'plain', subject: '', body: '' });
  const [tplBodyTab, setTplBodyTab] = useState<'edit' | 'preview'>('edit');
  const [showEmailDropdown, setShowEmailDropdown] = useState(false);
  const [showWaDropdown, setShowWaDropdown] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [previewContact, setPreviewContact] = useState<Contact | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewMode, setPreviewMode]  = useState<'email' | 'whatsapp'>('email');
  const fileRef = useRef<HTMLInputElement>(null);

  /* ─── Manual row modal state ─────────────────────── */
  const [rowModalKey, setRowModalKey] = useState(0);  // increment to force re-mount
  const [showRowModal, setShowRowModal] = useState(false);
  const [rowInitial, setRowInitial] = useState<Partial<Contact>>({});

  /* ─── Inline comment editing ─────────────────────── */
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  /* ─── Search / Filter / Sort ─────────────────────── */
  type SortKey = 'none' | 'name' | 'organization' | 'place' | 'status' | 'emails_sent' | 'wa_opened';
  const [searchQuery, setSearchQuery]         = useState('');
  const [filterStatus, setFilterStatus]       = useState<'all' | Contact['status']>('all');
  const [filterEmail, setFilterEmail]         = useState<'all' | 'yes' | 'no'>('all');
  const [filterWa, setFilterWa]               = useState<'all' | 'yes' | 'no'>('all');
  const [filterEmailSent, setFilterEmailSent] = useState<'all' | 'yes' | 'no'>('all');
  const [sortKey, setSortKey]                 = useState<SortKey>('none');
  const [sortDir, setSortDir]                 = useState<'asc' | 'desc'>('asc');

  const cycleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortKey('none'); setSortDir('asc'); }
  };

  const visibleContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = contacts.filter(c => {
      if (q && ![c.name, c.organization, c.place, c.contact, c.email, c.whatsapp, c.website, c.comment]
        .some(f => (f || '').toLowerCase().includes(q))) return false;
      if (filterStatus !== 'all' && (c.status || 'none') !== filterStatus) return false;
      if (filterEmail === 'yes' && !c.email)  return false;
      if (filterEmail === 'no'  &&  c.email)  return false;
      if (filterWa === 'yes' && !(c.whatsapp || c.contact)) return false;
      if (filterWa === 'no'  &&  (c.whatsapp || c.contact)) return false;
      if (filterEmailSent === 'yes' && !(c.emails_sent > 0)) return false;
      if (filterEmailSent === 'no'  &&   c.emails_sent > 0)  return false;
      return true;
    });
    if (sortKey !== 'none') {
      list = [...list].sort((a, b) => {
        let av: string | number = '', bv: string | number = '';
        if (sortKey === 'name')         { av = a.name.toLowerCase();          bv = b.name.toLowerCase(); }
        if (sortKey === 'organization') { av = a.organization.toLowerCase();  bv = b.organization.toLowerCase(); }
        if (sortKey === 'place')        { av = a.place.toLowerCase();         bv = b.place.toLowerCase(); }
        if (sortKey === 'status')       { av = a.status || 'none';            bv = b.status || 'none'; }
        if (sortKey === 'emails_sent')  { av = a.emails_sent || 0;           bv = b.emails_sent || 0; }
        if (sortKey === 'wa_opened')    { av = a.wa_opened || 0;             bv = b.wa_opened || 0; }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ?  1 : -1;
        return 0;
      });
    }
    return list;
  }, [contacts, searchQuery, filterStatus, filterEmail, filterWa, filterEmailSent, sortKey, sortDir]);

  const isFiltered = !!(searchQuery || filterStatus !== 'all' || filterEmail !== 'all' || filterWa !== 'all' || filterEmailSent !== 'all' || sortKey !== 'none');
  const clearFilters = () => { setSearchQuery(''); setFilterStatus('all'); setFilterEmail('all'); setFilterWa('all'); setFilterEmailSent('all'); setSortKey('none'); setSortDir('asc'); };

  /* ─── Load contacts from DB ─────────────────────── */
  const loadContacts = useCallback(async () => {
    if (contactsLoaded) return;
    try {
      const { data } = await api.get('/sayhi/contacts');
      // Don't reset emails_sent / wa_opened — load the real counts from DB
      setContacts(data.map((c: Contact) => ({ ...c, emailStatus: 'idle', waStatus: 'idle' })));
      setContactsLoaded(true);
    } catch { /* noop */ }
  }, [contactsLoaded]);

  useEffect(() => void loadContacts(), [loadContacts]);

  /* ─── Load templates ─────────────────────────────── */
  const loadTemplates = useCallback(async () => {
    if (templatesLoaded) return;
    try {
      const { data } = await api.get('/sayhi/templates');
      setTemplates(data);
      setTemplatesLoaded(true);
    } catch { /* noop */ }
  }, [templatesLoaded]);

  useEffect(() => void loadTemplates(), [loadTemplates]);

  /* ─── Excel upload ───────────────────────────────── */
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      let payload: Partial<Contact>[] = [];
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!raw.length) { toast.error('Excel is empty'); return; }
        payload = raw.map(r => mapRow(r));
      } catch (err: any) {
        toast.error('Failed to parse Excel file: ' + (err?.message || 'unknown error'));
        return;
      }
      try {
        const { data } = await api.post('/sayhi/contacts/bulk', payload);
        if (!data.length) { toast('No new contacts — all entries already exist'); return; }
        setContacts(prev => [...prev, ...data.map((c: Contact) => ({ ...c, emailStatus: 'idle' as const, waStatus: 'idle' as const }))]);
        toast.success(`Added ${data.length} new contact${data.length !== 1 ? 's' : ''} (duplicates skipped)`);
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || 'Server error';
        toast.error('Upload failed: ' + msg);
      }
    };
    reader.readAsBinaryString(file);
  };

  /* ─── Select helpers ─────────────────────────────── */
  const allSelected = visibleContacts.length > 0 && visibleContacts.every(c => selected.has(c.id));
  const toggleAll = () => {
    if (allSelected) setSelected(prev => { const s = new Set(prev); visibleContacts.forEach(c => s.delete(c.id)); return s; });
    else setSelected(prev => { const s = new Set(prev); visibleContacts.forEach(c => s.add(c.id)); return s; });
  };
  const toggleOne = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  /* ─── Send email (single) ────────────────────────── */
  const sendEmail = async (c: Contact, tpl?: Template | null) => {
    const t = tpl || activeEmailTpl;
    if (!t) { toast.error('Select an email template first'); return; }
    if (!c.email) { toast.error(`No email for ${c.name || 'contact'}`); return; }
    setContacts(prev => prev.map(x => x.id === c.id ? { ...x, emailStatus: 'sending' } : x));
    try {
      await api.post('/sayhi/send-email', {
        to: c.email,
        subject: applyVars(t.subject || 'Hello from Lyra Enterprises', c),
        body: applyVars(t.body, c),
        isHtml: t.format === 'html',
        contactId: c.id,
      });
      setContacts(prev => prev.map(x => x.id === c.id ? { ...x, emailStatus: 'sent', emails_sent: (x.emails_sent || 0) + 1 } : x));
      toast.success(`Email sent to ${c.name || c.email}`);
    } catch (err: any) {
      setContacts(prev => prev.map(x => x.id === c.id ? { ...x, emailStatus: 'failed' } : x));
      toast.error(`Failed: ${err.response?.data?.error || 'unknown'}`);
    }
  };

  /* ─── Open WhatsApp ──────────────────────────────── */
  const openWhatsApp = (c: Contact, tpl?: Template | null) => {
    const t = tpl || activeWaTpl;
    const phone = normalizePhone(c.whatsapp || c.contact);
    if (!phone) { toast.error(`No WhatsApp number for ${c.name || 'contact'}`); return; }
    const text = t ? applyVars(t.body, c) : `Hi ${c.name || 'there'}, greetings from Lyra Enterprises!`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    // Persist WA opened count
    api.post(`/sayhi/contacts/${c.id}/wa-opened`).catch(() => {});
    setContacts(prev => prev.map(x => x.id === c.id ? { ...x, waStatus: 'opened', wa_opened: (x.wa_opened || 0) + 1 } : x));
  };

  /* ─── Bulk send ──────────────────────────────────── */
  const bulkSendEmail = async () => {
    if (!activeEmailTpl) { toast.error('Select an email template first'); return; }
    const targets = contacts.filter(c => selected.has(c.id) && c.email && c.emailStatus !== 'sent');
    if (!targets.length) { toast.error('No contacts with email in selection'); return; }
    setBulkSending(true);
    let ok = 0;
    for (const c of targets) {
      await sendEmail(c, activeEmailTpl);
      ok++;
    }
    setBulkSending(false);
    toast.success(`Sent ${ok} emails`);
  };

  const bulkWhatsApp = () => {
    if (!activeWaTpl) { toast.error('Select a WhatsApp template first'); return; }
    const targets = contacts.filter(c => selected.has(c.id));
    if (!targets.length) { toast.error('No contacts selected'); return; }
    targets.forEach(c => openWhatsApp(c, activeWaTpl));
  };

  /* ─── Template CRUD ──────────────────────────────── */
  const saveTpl = async () => {
    if (!tplForm.name || !tplForm.body) { toast.error('Name and body are required'); return; }
    try {
      if (editingTpl?.id) {
        await api.put(`/sayhi/templates/${editingTpl.id}`, tplForm);
        setTemplates(prev => prev.map(t => t.id === editingTpl.id ? { ...t, ...tplForm } : t));
        toast.success('Template updated');
      } else {
        const { data } = await api.post('/sayhi/templates', tplForm);
        setTemplates(prev => [...prev, data]);
        toast.success('Template created');
      }
      setShowTemplateModal(false);
      setEditingTpl(null);
    } catch { toast.error('Failed to save template'); }
  };

  const deleteTpl = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await api.delete(`/sayhi/templates/${id}`);
      setTemplates(prev => prev.filter(t => t.id !== id));
      if (activeEmailTpl?.id === id) setActiveEmailTpl(null);
      if (activeWaTpl?.id === id) setActiveWaTpl(null);
      toast.success('Deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const openNewTpl = (type: 'email' | 'whatsapp') => {
    setEditingTpl({});
    setTplForm({ name: '', type, format: 'plain', subject: '', body: '' });
    setTplBodyTab('edit');
    setShowTemplateModal(true);
  };

  const openEditTpl = (t: Template) => {
    setEditingTpl(t);
    setTplForm({ name: t.name, type: t.type, format: t.format || 'plain', subject: t.subject || '', body: t.body });
    setTplBodyTab('edit');
    setShowTemplateModal(true);
  };

  const emailTpls = templates.filter(t => t.type === 'email');
  const waTpls    = templates.filter(t => t.type === 'whatsapp');

  /* ─── Preview modal ──────────────────────────────── */
  const openPreview = (c: Contact, mode: 'email' | 'whatsapp') => {
    setPreviewContact(c);
    setPreviewMode(mode);
    setShowPreviewModal(true);
  };

  /* ─── Manual row add / edit / delete ──────────────── */
  const openAddRow = () => {
    setRowInitial({});
    setRowModalKey(k => k + 1); // fresh mount = fresh state
    setShowRowModal(true);
  };

  const openEditRow = (c: Contact) => {
    setRowInitial(c);
    setRowModalKey(k => k + 1);
    setShowRowModal(true);
  };

  const updateStatus = async (id: string, status: Contact['status']) => {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    try { await api.patch(`/sayhi/contacts/${id}`, { status }); }
    catch { toast.error('Failed to save status'); }
  };

  const updateComment = async (id: string, comment: string) => {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, comment } : c));
    try { await api.patch(`/sayhi/contacts/${id}`, { comment }); }
    catch { toast.error('Failed to save comment'); }
  };

  const handleRowSave = async (data: Omit<Contact, 'id' | 'emailStatus' | 'waStatus' | 'emails_sent' | 'wa_opened'>) => {
    try {
      if (rowInitial.id) {
        await api.put(`/sayhi/contacts/${rowInitial.id}`, data);
        setContacts(prev => prev.map(c => c.id === rowInitial.id ? { ...c, ...data } : c));
        toast.success('Row updated');
      } else {
        if (isDuplicateContact(contacts, data.contact, data.email)) {
          toast.error('A contact with this phone number or email already exists');
          return;
        }
        const { data: created } = await api.post('/sayhi/contacts', data);
        setContacts(prev => [...prev, { ...created, emailStatus: 'idle', waStatus: 'idle' }]);
        toast.success('Row added');
      }
      setShowRowModal(false);
    } catch { toast.error('Failed to save contact'); }
  };

  const deleteRow = async (id: string) => {
    try {
      await api.delete(`/sayhi/contacts/${id}`);
      setContacts(prev => prev.filter(c => c.id !== id));
      setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
    } catch { toast.error('Failed to delete'); }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected contact${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await api.delete('/sayhi/contacts/bulk', { data: { ids } });
      setContacts(prev => prev.filter(c => !selected.has(c.id)));
      setSelected(new Set());
      toast.success(`Deleted ${ids.length} contact${ids.length !== 1 ? 's' : ''}`);
    } catch { toast.error('Failed to delete contacts'); }
  };

  /* ─── Drag & drop ─────────────────────────────────── */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  /* ─────────────────────────────────────────────────── */
  return (
    <div className="p-4 space-y-3 max-w-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">👋 Say Hi</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload a contact list and reach out via Email or WhatsApp</p>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e => { if (e.target.files?.[0]) { handleFile(e.target.files[0]); e.target.value = ''; } }} />
      </div>

      {/* ── Upload drop zone (when no contacts) ── */}
      {contacts.length === 0 && (
        <div
          onDrop={onDrop} onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-14 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
        >
          <Upload size={36} className="mx-auto text-gray-300 mb-3"/>
          <div className="text-gray-500 font-medium">Drop an Excel file here, or click to browse</div>
          <div className="text-gray-400 text-sm mt-1">Columns: Google Map, Name, Organization, Place Type, Contact No, Email, Website, WhatsApp Number</div>
          <div className="text-gray-300 text-xs mt-2">.xlsx · .xls · .csv</div>
        </div>
      )}

      {/* ── Add Row shortcut when no contacts ── */}
      {contacts.length === 0 && (
        <div className="text-center">
          <span className="text-xs text-gray-400">or&nbsp;</span>
          <button onClick={openAddRow} className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1">
            <UserPlus size={12}/> add contacts manually
          </button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap gap-3 items-center">
          {/* Manage Templates */}
          <button onClick={() => { setEditingTpl({}); setTplForm({ name:'', type:'email', format:'plain', subject:'', body:'' }); setTplBodyTab('edit'); setShowTemplateModal(true); }}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <Pencil size={13}/> Manage Templates
          </button>
          <div className="w-px h-6 bg-gray-200"/>
          {/* Email template picker */}
          <div className="flex items-center gap-2">
            <Mail size={15} className="text-blue-500 shrink-0"/>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email:</span>
            <div className="relative">
              <button onClick={() => { setShowEmailDropdown(v => !v); setShowWaDropdown(false); }}
                className={`flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-lg border transition-colors ${activeEmailTpl ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                {activeEmailTpl ? activeEmailTpl.name : 'Choose template'}
                <ChevronDown size={13}/>
              </button>
              {showEmailDropdown && (
                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg min-w-48 py-1">
                  {emailTpls.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No email templates yet</div>}
                  {emailTpls.map(t => (
                    <button key={t.id} onClick={() => { setActiveEmailTpl(t); setShowEmailDropdown(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${activeEmailTpl?.id === t.id ? 'text-blue-600 font-semibold' : 'text-gray-700'}`}>
                      {t.name}
                    </button>
                  ))}
                  <div className="border-t border-gray-100 mt-1">
                    <button onClick={() => { setShowEmailDropdown(false); openNewTpl('email'); }}
                      className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 flex items-center gap-1">
                      <Plus size={12}/> New Email Template
                    </button>
                  </div>
                </div>
              )}
            </div>
            {activeEmailTpl && <button onClick={() => setActiveEmailTpl(null)} className="text-gray-300 hover:text-gray-500"><X size={13}/></button>}
          </div>

          <div className="w-px h-6 bg-gray-200"/>

          {/* WhatsApp template picker */}
          <div className="flex items-center gap-2">
            <MessageCircle size={15} className="text-green-500 shrink-0"/>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">WhatsApp:</span>
            <div className="relative">
              <button onClick={() => { setShowWaDropdown(v => !v); setShowEmailDropdown(false); }}
                className={`flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-lg border transition-colors ${activeWaTpl ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                {activeWaTpl ? activeWaTpl.name : 'Choose template'}
                <ChevronDown size={13}/>
              </button>
              {showWaDropdown && (
                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg min-w-48 py-1">
                  {waTpls.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No WhatsApp templates yet</div>}
                  {waTpls.map(t => (
                    <button key={t.id} onClick={() => { setActiveWaTpl(t); setShowWaDropdown(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-green-50 ${activeWaTpl?.id === t.id ? 'text-green-600 font-semibold' : 'text-gray-700'}`}>
                      {t.name}
                    </button>
                  ))}
                  <div className="border-t border-gray-100 mt-1">
                    <button onClick={() => { setShowWaDropdown(false); openNewTpl('whatsapp'); }}
                      className="w-full text-left px-3 py-2 text-xs text-green-600 hover:bg-green-50 flex items-center gap-1">
                      <Plus size={12}/> New WhatsApp Template
                    </button>
                  </div>
                </div>
              )}
            </div>
            {activeWaTpl && <button onClick={() => setActiveWaTpl(null)} className="text-gray-300 hover:text-gray-500"><X size={13}/></button>}
          </div>

          <div className="flex-1"/>

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{selected.size} selected</span>
              <button onClick={bulkSendEmail} disabled={bulkSending || !activeEmailTpl}
                className="btn btn-secondary flex items-center gap-1 text-xs py-1.5"
                title={!activeEmailTpl ? 'Choose an email template first' : ''}>
                <Mail size={13}/> {bulkSending ? 'Sending…' : 'Bulk Email'}
              </button>
              <button onClick={bulkWhatsApp} disabled={!activeWaTpl}
                className="btn btn-secondary flex items-center gap-1 text-xs py-1.5 !text-green-700 !border-green-300 hover:!bg-green-50"
                title={!activeWaTpl ? 'Choose a WhatsApp template first' : ''}>
                <MessageCircle size={13}/> Bulk WhatsApp
              </button>
              <button onClick={bulkDelete}
                className="btn btn-secondary flex items-center gap-1 text-xs py-1.5 !text-red-600 !border-red-300 hover:!bg-red-50"
                title="Delete selected contacts">
                <Trash2 size={13}/> Delete
              </button>
            </div>
          )}

          <div className="w-px h-6 bg-gray-200"/>
          <button onClick={downloadSample} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1" title="Download a sample Excel template">
            <Download size={13}/> Sample Excel
          </button>
          <button onClick={openAddRow} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <UserPlus size={13}/> Add Row
          </button>
          <button onClick={() => fileRef.current?.click()} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <Upload size={13}/> Upload Excel
          </button>
        </div>

      {/* ── Search / Filter / Sort bar ── */}
      {contacts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          {/* Single row */}
          <div className="flex items-center gap-2 px-2.5 py-2">
            {/* Status pills */}
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setFilterStatus('all')} className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${filterStatus === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'text-gray-400 border-gray-200 hover:border-gray-400 hover:text-gray-600'}`}>
                All ({contacts.length})
              </button>
              {STATUS_OPTIONS.map(o => {
                const count = contacts.filter(c => (c.status||'none') === o.value).length;
                return (
                  <button key={o.value} onClick={() => setFilterStatus(filterStatus === o.value ? 'all' : o.value)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${filterStatus === o.value ? o.cls : 'text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600'}`}>
                    {filterStatus === o.value && <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${o.dot}`}/>}{o.label} ({count})
                  </button>
                );
              })}
            </div>
            <div className="w-px h-4 bg-gray-200 shrink-0"/>
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
              <input className="w-full pl-6 pr-6 py-1 text-xs border border-gray-200 rounded-md bg-gray-50 focus:bg-white focus:border-blue-300 outline-none transition" placeholder="Search…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
              {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"><X size={11}/></button>}
            </div>
            {/* Compact selects */}
            <select className={`text-xs border rounded-md px-1.5 py-1 outline-none cursor-pointer shrink-0 ${filterEmail!=='all'?'border-blue-300 bg-blue-50 text-blue-700':'border-gray-200 bg-gray-50 text-gray-500'}`} value={filterEmail} onChange={e=>setFilterEmail(e.target.value as typeof filterEmail)}>
              <option value="all">Email</option><option value="yes">Has email</option><option value="no">No email</option>
            </select>
            <select className={`text-xs border rounded-md px-1.5 py-1 outline-none cursor-pointer shrink-0 ${filterWa!=='all'?'border-green-300 bg-green-50 text-green-700':'border-gray-200 bg-gray-50 text-gray-500'}`} value={filterWa} onChange={e=>setFilterWa(e.target.value as typeof filterWa)}>
              <option value="all">WA</option><option value="yes">Has WA</option><option value="no">No WA</option>
            </select>
            <select className={`text-xs border rounded-md px-1.5 py-1 outline-none cursor-pointer shrink-0 ${filterEmailSent!=='all'?'border-purple-300 bg-purple-50 text-purple-700':'border-gray-200 bg-gray-50 text-gray-500'}`} value={filterEmailSent} onChange={e=>setFilterEmailSent(e.target.value as typeof filterEmailSent)}>
              <option value="all">Sent</option><option value="yes">Emailed</option><option value="no">Not emailed</option>
            </select>
            {/* Sort */}
            <select className="text-xs border border-gray-200 rounded-md px-1.5 py-1 bg-gray-50 text-gray-500 outline-none cursor-pointer shrink-0" value={`${sortKey}:${sortDir}`} onChange={e=>{const[k,d]=e.target.value.split(':') as [SortKey,'asc'|'desc'];setSortKey(k);setSortDir(d);}}>
              <option value="none:asc">Sort</option>
              <option value="name:asc">Name A→Z</option><option value="name:desc">Name Z→A</option>
              <option value="organization:asc">Org A→Z</option><option value="organization:desc">Org Z→A</option>
              <option value="place:asc">Place Type A→Z</option><option value="place:desc">Place Type Z→A</option>
              <option value="status:asc">Status A→Z</option><option value="status:desc">Status Z→A</option>
              <option value="emails_sent:desc">Most emailed</option><option value="emails_sent:asc">Least emailed</option>
              <option value="wa_opened:desc">Most WA</option><option value="wa_opened:asc">Least WA</option>
            </select>
            {isFiltered && (
              <button onClick={clearFilters} className="shrink-0 flex items-center gap-0.5 text-xs text-red-400 hover:text-red-600 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50">
                <X size={11}/> Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Contact Table ── */}
      {contacts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {visibleContacts.length === 0 ? (
            <div className="py-14 text-center text-gray-400">
              <Search size={28} className="mx-auto mb-2 opacity-20"/>
              <p className="text-sm">No contacts match your filters.</p>
              <button onClick={clearFilters} className="mt-2 text-xs text-blue-500 hover:underline">Clear filters</button>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="p-3 w-8">
                    <button onClick={toggleAll} className="text-gray-400 hover:text-blue-600">
                      {allSelected ? <CheckSquare size={15}/> : <Square size={15}/>}
                    </button>
                  </th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">#</th>
                  {(['name','organization','place'] as SortKey[]).map(col => (
                    <th key={col} className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <button onClick={() => cycleSort(col)} className="flex items-center gap-1 hover:text-gray-800 group">
                        {col === 'name' ? 'Name' : col === 'organization' ? 'Organization' : 'Place Type'}
                        {sortKey === col ? (sortDir === 'asc' ? <ArrowUp size={11} className="text-blue-500"/> : <ArrowDown size={11} className="text-blue-500"/>) : <ArrowUpDown size={11} className="opacity-0 group-hover:opacity-40"/>}
                      </button>
                    </th>
                  ))}
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => cycleSort('emails_sent')} className="flex items-center gap-1 hover:text-gray-800 group">
                      Email
                      {sortKey === 'emails_sent' ? (sortDir === 'asc' ? <ArrowUp size={11} className="text-blue-500"/> : <ArrowDown size={11} className="text-blue-500"/>) : <ArrowUpDown size={11} className="opacity-0 group-hover:opacity-40"/>}
                    </button>
                  </th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Website</th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Map</th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => cycleSort('status')} className="flex items-center gap-1 hover:text-gray-800 group">
                      Status
                      {sortKey === 'status' ? (sortDir === 'asc' ? <ArrowUp size={11} className="text-blue-500"/> : <ArrowDown size={11} className="text-blue-500"/>) : <ArrowUpDown size={11} className="opacity-0 group-hover:opacity-40"/>}
                    </button>
                  </th>
                  <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Comment</th>
                  <th className="p-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleContacts.map((c, idx) => (
                  <tr key={c.id} className={`border-b border-gray-100 transition-colors ${selected.has(c.id) ? 'bg-blue-50/40' : 'hover:bg-gray-50'}`}>
                    <td className="p-3">
                      <button onClick={() => toggleOne(c.id)} className="text-gray-400 hover:text-blue-600">
                        {selected.has(c.id) ? <CheckSquare size={15} className="text-blue-500"/> : <Square size={15}/>}
                      </button>
                    </td>
                    <td className="p-3 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="p-3 font-medium text-gray-900 min-w-[8rem] break-words whitespace-normal">{c.name || <span className="text-gray-300">—</span>}</td>
                    <td className="p-3 text-gray-600 min-w-[8rem] break-words whitespace-normal">
                      {c.organization || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="p-3 text-gray-500 min-w-[7rem] break-words whitespace-normal">{c.place || <span className="text-gray-300">—</span>}</td>
                    <td className="p-3 text-gray-600 whitespace-nowrap">{c.contact || <span className="text-gray-300">—</span>}</td>
                    <td className="p-3 text-gray-600 min-w-[9rem] break-all">{c.email ? <span title={c.email}>{c.email}{c.emails_sent > 0 && <span className="ml-1 text-xs text-green-600 font-medium">✓{c.emails_sent}</span>}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="p-3 min-w-[5rem]">
                      {c.website ? <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-500 hover:text-blue-700 hover:underline">Visit</a> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="p-3">
                      {c.map
                        ? <a href={c.map} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-500 hover:text-blue-700 hover:underline">View</a>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    {/* Status */}
                    <td className="p-3">
                      <select
                        value={c.status || 'none'}
                        onChange={e => updateStatus(c.id, e.target.value as Contact['status'])}
                        className={`text-xs font-medium px-2 py-1 rounded-full border cursor-pointer outline-none ${statusMeta(c.status || 'none').cls}`}
                      >
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    {/* Comment */}
                    <td className="p-3 max-w-48" onClick={() => { setEditingCommentId(c.id); setEditingCommentText(c.comment || ''); }}>
                      {editingCommentId === c.id ? (
                        <textarea
                          autoFocus
                          className="w-full text-xs border border-blue-300 rounded p-1.5 outline-none resize-none min-w-40"
                          rows={3}
                          value={editingCommentText}
                          onChange={e => setEditingCommentText(e.target.value)}
                          onBlur={() => { updateComment(c.id, editingCommentText); setEditingCommentId(null); }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className={`flex items-center gap-1 text-xs cursor-text ${c.comment ? 'text-gray-700' : 'text-gray-300'}`}>
                          <MessageSquare size={11} className="shrink-0 text-gray-300"/>
                          <span className="truncate max-w-40">{c.comment || 'Add note...'}</span>
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Email button */}
                        <button
                          onClick={() => activeEmailTpl ? sendEmail(c) : openPreview(c, 'email')}
                          disabled={c.emailStatus === 'sending'}
                          title={c.email ? (activeEmailTpl ? `Email with "${activeEmailTpl.name}"` : 'Preview email') : 'No email address'}
                          className={`p-1.5 rounded-lg border text-xs transition-colors ${
                            !c.email ? 'opacity-30 cursor-not-allowed border-gray-200 text-gray-400' :
                            c.emailStatus === 'sent' ? 'border-green-300 bg-green-50 text-green-600' :
                            c.emailStatus === 'failed' ? 'border-red-300 bg-red-50 text-red-500' :
                            c.emailStatus === 'sending' ? 'border-blue-300 bg-blue-50 text-blue-500 animate-pulse' :
                            'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
                          }`}
                        >
                          {c.emailStatus === 'sent' ? '✓' : c.emailStatus === 'failed' ? '✗' : <Mail size={13}/>}
                        </button>

                        {/* WhatsApp button */}
                        <button
                          onClick={() => openWhatsApp(c)}
                          title={(c.whatsapp || c.contact) ? (activeWaTpl ? `WhatsApp with "${activeWaTpl.name}"` : 'Open WhatsApp') : 'No number'}
                          className={`p-1.5 rounded-lg border text-xs transition-colors ${
                            !(c.whatsapp || c.contact) ? 'opacity-30 cursor-not-allowed border-gray-200 text-gray-400' :
                            c.waStatus === 'opened' ? 'border-green-300 bg-green-50 text-green-600' :
                            'border-green-200 bg-green-50 text-green-600 hover:bg-green-100'
                          }`}
                        >
                          <MessageCircle size={13}/>
                        </button>

                        {/* Call button */}
                        <a
                          href={(c.contact || c.whatsapp) ? `tel:${(c.contact || c.whatsapp).replace(/\D/g, '')}` : '#'}
                          title={(c.contact || c.whatsapp) ? `Call ${c.contact || c.whatsapp}` : 'No number'}
                          onClick={e => { if (!(c.contact || c.whatsapp)) e.preventDefault(); }}
                          className={`p-1.5 rounded-lg border text-xs transition-colors ${
                            !(c.contact || c.whatsapp) ? 'opacity-30 cursor-not-allowed border-gray-200 text-gray-400 pointer-events-none' :
                            'border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100'
                          }`}
                        >
                          <Phone size={13}/>
                        </a>

                        {/* Preview button */}
                        <button onClick={() => openPreview(c, 'email')}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-100 text-xs"
                          title="Preview message">
                          <Send size={12}/>
                        </button>

                        {/* Edit row */}
                        <button onClick={() => openEditRow(c)}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-yellow-50 hover:text-yellow-600 hover:border-yellow-300 text-xs"
                          title="Edit row">
                          <Pencil size={12}/>
                        </button>

                        {/* Delete row */}
                        <button onClick={() => deleteRow(c.id)}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500 hover:border-red-300 text-xs"
                          title="Delete row">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <div className="px-4 py-2.5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
            <span className="flex items-center gap-2">
              <span>
                {visibleContacts.length !== contacts.length
                  ? <><strong className="text-gray-600">{visibleContacts.length}</strong> of {contacts.length} contacts</>
                  : <>{contacts.length} contacts</>}
              </span>
              <button onClick={openAddRow} className="text-blue-500 hover:underline inline-flex items-center gap-0.5"><UserPlus size={11}/> Add Row</button>
            </span>
            <span className="flex items-center gap-3 flex-wrap">
              {STATUS_OPTIONS.filter(o => o.value !== 'none').map(o => {
                const count = contacts.filter(c => (c.status || 'none') === o.value).length;
                if (!count) return null;
                return <span key={o.value} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${o.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${o.dot}`}/>{o.label}: {count}</span>;
              })}
              <span className="text-gray-300">|</span>
              <span className="text-green-600">{contacts.reduce((s, c) => s + (c.emails_sent || 0), 0)} emails sent</span>
              <span className="text-green-600">{contacts.reduce((s, c) => s + (c.wa_opened || 0), 0)} WA opened</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Add / Edit Row Modal ── */}
      <RowModal
        key={rowModalKey}
        open={showRowModal}
        initial={rowInitial}
        onSave={handleRowSave}
        onClose={() => setShowRowModal(false)}
      />

      {/* ── Template Management Modal ── */}
      <Modal open={showTemplateModal} onClose={() => setShowTemplateModal(false)} title="Templates" size="lg">
        <div className="space-y-4">
          {/* List */}
          {templates.length > 0 && (
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 bg-gray-50">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.type === 'email' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                    {t.type === 'email' ? '✉' : '💬'} {t.type}
                  </span>
                  <span className="text-sm font-medium text-gray-800 flex-1">{t.name}</span>
                  {t.format === 'html' && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-medium">HTML</span>}
                  {t.subject && <span className="text-xs text-gray-400 truncate max-w-36">{t.subject}</span>}
                  <button onClick={() => openEditTpl(t)} className="text-gray-400 hover:text-blue-500 p-1"><Pencil size={13}/></button>
                  <button onClick={() => deleteTpl(t.id)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={13}/></button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">{editingTpl?.id ? 'Edit Template' : 'New Template'}</div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Name *</label>
                  <input className="form-input" value={tplForm.name} onChange={e => setTplForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Cold Intro" />
                </div>
                <div>
                  <label className="form-label">Type *</label>
                  <select className="form-select" value={tplForm.type} onChange={e => setTplForm(p => ({ ...p, type: e.target.value as 'email' | 'whatsapp', format: e.target.value === 'whatsapp' ? 'plain' : p.format }))}>
                    <option value="email">✉ Email</option>
                    <option value="whatsapp">💬 WhatsApp</option>
                  </select>
                </div>
              </div>
              {tplForm.type === 'email' && (
                <>
                  <div>
                    <label className="form-label">Subject</label>
                    <input className="form-input" value={tplForm.subject} onChange={e => setTplForm(p => ({ ...p, subject: e.target.value }))} placeholder="e.g. Lyra Vending Machine – Solutions for {place}" />
                  </div>
                  {/* Format toggle */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-500">Format:</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                      <button
                        type="button"
                        onClick={() => { setTplForm(p => ({ ...p, format: 'plain' })); setTplBodyTab('edit'); }}
                        className={`px-3 py-1.5 font-medium transition-colors ${tplForm.format === 'plain' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                        Plain Text
                      </button>
                      <button
                        type="button"
                        onClick={() => setTplForm(p => ({ ...p, format: 'html' }))}
                        className={`px-3 py-1.5 font-medium transition-colors ${tplForm.format === 'html' ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                        {'</>'} HTML
                      </button>
                    </div>
                    {tplForm.format === 'html' && (
                      <span className="text-xs text-orange-500">Write full HTML — sent as-is to the email client</span>
                    )}
                  </div>
                </>
              )}
              <div>
                {/* Body label + edit/preview tabs for HTML mode */}
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label mb-0">Body *</label>
                  {tplForm.format === 'html' && (
                    <div className="flex rounded border border-gray-200 overflow-hidden text-xs">
                      <button type="button" onClick={() => setTplBodyTab('edit')}
                        className={`px-2.5 py-1 font-medium transition-colors ${tplBodyTab === 'edit' ? 'bg-gray-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                        Edit
                      </button>
                      <button type="button" onClick={() => setTplBodyTab('preview')}
                        className={`px-2.5 py-1 font-medium transition-colors ${tplBodyTab === 'preview' ? 'bg-gray-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                        Preview
                      </button>
                    </div>
                  )}
                </div>
                {tplForm.format === 'html' && tplBodyTab === 'preview' ? (
                  <div
                    className="border border-gray-200 rounded-lg p-3 h-48 overflow-y-auto bg-white text-sm"
                    dangerouslySetInnerHTML={{ __html: tplForm.body }}
                  />
                ) : (
                  <textarea
                    className={`form-input h-48 text-xs ${tplForm.format === 'html' ? 'font-mono bg-gray-950 text-green-300 border-gray-700' : ''}`}
                    value={tplForm.body}
                    onChange={e => setTplForm(p => ({ ...p, body: e.target.value }))}
                    spellCheck={tplForm.format !== 'html'}
                    placeholder={
                      tplForm.format === 'html'
                        ? '<p>Hi {name},</p>\n\n<p>We are <strong>Lyra Enterprises</strong>...</p>\n\n<p>Best regards,<br/>Lyra Team</p>'
                        : tplForm.type === 'email'
                          ? 'Hi {name},\n\nWe are Lyra Enterprises...\n\nBest regards,\nLyra Team'
                          : 'Hi {name}! 👋\n\nWe are Lyra Enterprises...'
                    }
                  />
                )}
                <div className="text-xs text-gray-400 mt-1 flex items-center gap-1 flex-wrap">
                  <span>Variables:</span>
                  {['{name}','{organization}','{place}','{contact}','{website}','{whatsapp}'].map(v => (
                    <code key={v} className="bg-gray-100 px-1 rounded cursor-pointer hover:bg-blue-100 hover:text-blue-700"
                      onClick={() => setTplForm(p => ({ ...p, body: p.body + v }))} title={`Click to insert ${v}`}>{v}</code>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                {editingTpl?.id && <button onClick={() => { setEditingTpl(null); setTplForm({ name:'', type:'email', format:'plain', subject:'', body:'' }); }} className="btn btn-secondary">Cancel Edit</button>}
                <button onClick={saveTpl} className="btn btn-primary flex items-center gap-1"><Plus size={14}/>{editingTpl?.id ? 'Update' : 'Save Template'}</button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Preview / Send Modal ── */}
      {showPreviewModal && previewContact && (
        <Modal open={showPreviewModal} onClose={() => setShowPreviewModal(false)} title={`Message Preview — ${previewContact.name || 'Contact'}`} size="lg">
          <div className="space-y-4">
            <div className="flex gap-2">
              <button onClick={() => setPreviewMode('email')} className={`btn text-xs py-1.5 ${previewMode === 'email' ? 'btn-primary' : 'btn-secondary'}`}>✉ Email</button>
              <button onClick={() => setPreviewMode('whatsapp')} className={`btn text-xs py-1.5 ${previewMode === 'whatsapp' ? 'btn-primary !bg-green-600 !border-green-600' : 'btn-secondary'}`}>💬 WhatsApp</button>
            </div>

            {previewMode === 'email' && (
              <div className="space-y-3">
                <div>
                  <label className="form-label">Template</label>
                  <select className="form-select" value={activeEmailTpl?.id || ''} onChange={e => setActiveEmailTpl(emailTpls.find(t => t.id === e.target.value) || null)}>
                    <option value="">— None —</option>
                    {emailTpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {activeEmailTpl && (
                  <div className="bg-gray-50 rounded-lg p-3 text-sm border border-gray-200">
                    <div className="font-semibold text-gray-700 mb-1">Subject: {applyVars(activeEmailTpl.subject || '', previewContact)}</div>
                    {activeEmailTpl.format === 'html' ? (
                      <div className="border border-gray-100 rounded bg-white p-2 overflow-auto max-h-48"
                        dangerouslySetInnerHTML={{ __html: applyVars(activeEmailTpl.body, previewContact) }} />
                    ) : (
                      <div className="text-gray-600 whitespace-pre-wrap">{applyVars(activeEmailTpl.body, previewContact)}</div>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowPreviewModal(false)} className="btn btn-secondary">Cancel</button>
                  <button onClick={() => { sendEmail(previewContact); setShowPreviewModal(false); }} disabled={!activeEmailTpl || !previewContact.email} className="btn btn-primary flex items-center gap-1">
                    <Mail size={14}/> Send Email
                  </button>
                </div>
              </div>
            )}

            {previewMode === 'whatsapp' && (
              <div className="space-y-3">
                <div>
                  <label className="form-label">Template</label>
                  <select className="form-select" value={activeWaTpl?.id || ''} onChange={e => setActiveWaTpl(waTpls.find(t => t.id === e.target.value) || null)}>
                    <option value="">— None (default greeting) —</option>
                    {waTpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-sm border border-green-200 whitespace-pre-wrap text-gray-700">
                  {activeWaTpl ? applyVars(activeWaTpl.body, previewContact) : `Hi ${previewContact.name || 'there'}, greetings from Lyra Enterprises!`}
                </div>
                <div className="text-xs text-gray-400">Will open WhatsApp with number: {normalizePhone(previewContact.whatsapp || previewContact.contact) || 'Not set'}</div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowPreviewModal(false)} className="btn btn-secondary">Cancel</button>
                  <button onClick={() => { openWhatsApp(previewContact); setShowPreviewModal(false); }}
                    disabled={!(previewContact.whatsapp || previewContact.contact)}
                    className="btn btn-primary !bg-green-600 !border-green-600 flex items-center gap-1">
                    <MessageCircle size={14}/> Open WhatsApp
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

    </div>
  );
}

