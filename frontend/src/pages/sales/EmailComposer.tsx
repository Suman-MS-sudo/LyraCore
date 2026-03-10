import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Send, Eye, Trash2, Mail, Users, BarChart2, ChevronDown,
  ChevronUp, X, Plus, RefreshCw, Clock, CheckCircle2,
  AlertCircle, Inbox, PenSquare, EyeOff
} from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  subject: string;
  body_html: string;
  recipients: string[];
  sent_count: number;
  open_count: number;
  created_at: string;
}

interface OpenRecord {
  recipient_email: string;
  first_opened: string;
  open_count: number;
}

interface CampaignDetail extends Campaign {
  opens: OpenRecord[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function openRateColor(rate: number) {
  if (rate >= 50) return 'text-green-600';
  if (rate >= 20) return 'text-amber-500';
  return 'text-red-500';
}

// ─── Recipient Tag Input ──────────────────────────────────────────────────────

function RecipientInput({
  recipients, onChange
}: { recipients: string[]; onChange: (r: string[]) => void }) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addEmail = (raw: string) => {
    // Support pasting comma/semicolon/space separated lists
    const parts = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid: string[] = [];
    const bad: string[] = [];
    for (const p of parts) {
      if (!emailRe.test(p)) { bad.push(p); continue; }
      if (!recipients.includes(p)) valid.push(p);
    }
    if (bad.length) toast.error(`Invalid: ${bad.join(', ')}`);
    if (valid.length) onChange([...recipients, ...valid]);
    setInput('');
  };

  const remove = (email: string) => onChange(recipients.filter(e => e !== email));

  return (
    <div
      className="min-h-[42px] flex flex-wrap gap-1.5 items-center border border-gray-200 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-blue-400 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {recipients.map(email => (
        <span key={email} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
          {email}
          <button type="button" onClick={() => remove(email)} className="text-blue-400 hover:text-blue-700 ml-0.5">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (['Enter', 'Tab', ',', ';'].includes(e.key)) {
            e.preventDefault();
            if (input.trim()) addEmail(input);
          } else if (e.key === 'Backspace' && !input && recipients.length) {
            onChange(recipients.slice(0, -1));
          }
        }}
        onPaste={e => {
          e.preventDefault();
          addEmail(e.clipboardData.getData('text'));
        }}
        onBlur={() => { if (input.trim()) addEmail(input); }}
        className="flex-1 min-w-[160px] text-sm outline-none bg-transparent py-0.5"
        placeholder={recipients.length ? '' : 'Add email and press Enter…'}
      />
    </div>
  );
}

// ─── Openers Modal ────────────────────────────────────────────────────────────

function OpenersModal({
  campaign, onClose
}: { campaign: CampaignDetail | null; onClose: () => void }) {
  if (!campaign) return null;
  const openedEmails = new Set(campaign.opens.map(o => o.recipient_email));
  const notOpened = campaign.recipients.filter(e => !openedEmails.has(e));
  const openRate  = campaign.recipients.length
    ? Math.round((openedEmails.size / campaign.recipients.length) * 100) : 0;

  return (
    <Modal open={!!campaign} onClose={onClose} title="Email Opens" size="lg">
      <div className="space-y-4">
        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Sent',     value: campaign.sent_count,  color: 'bg-blue-50  border-blue-200',  tc: 'text-blue-700' },
            { label: 'Opened',   value: openedEmails.size,    color: 'bg-green-50 border-green-200', tc: 'text-green-700' },
            { label: 'Open Rate',value: `${openRate}%`,       color: 'bg-purple-50 border-purple-200', tc: openRateColor(openRate) },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border p-3 text-center ${s.color}`}>
              <div className={`text-2xl font-bold ${s.tc}`}>{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${openRate >= 50 ? 'bg-green-500' : openRate >= 20 ? 'bg-amber-400' : 'bg-red-400'}`}
            style={{ width: `${openRate}%` }}
          />
        </div>

        {/* Opened */}
        {campaign.opens.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Eye size={14} className="text-green-600" />
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Opened</span>
            </div>
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {campaign.opens.map(o => (
                <div key={o.recipient_email} className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-green-600 shrink-0" />
                    <span className="text-sm text-gray-800">{o.recipient_email}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">{fmtDate(o.first_opened)}</div>
                    <div className="text-xs text-gray-400">{o.open_count}× opened</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Not opened */}
        {notOpened.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <EyeOff size={14} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Not Opened ({notOpened.length})</span>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {notOpened.map(email => (
                <div key={email} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                  <AlertCircle size={13} className="text-gray-300 shrink-0" />
                  <span className="text-sm text-gray-500">{email}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">Close</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── HTML Toolbar ─────────────────────────────────────────────────────────────

const FONT_SIZES = ['12px','14px','16px','18px','20px','24px','28px','32px'];
const FONT_FAMILIES = [
  { label: 'Default', val: 'sans-serif' },
  { label: 'Arial', val: 'Arial, sans-serif' },
  { label: 'Georgia', val: 'Georgia, serif' },
  { label: 'Courier', val: '"Courier New", monospace' },
  { label: 'Verdana', val: 'Verdana, sans-serif' },
  { label: 'Times', val: '"Times New Roman", serif' },
];

function EditorToolbar({ onCommand }: { onCommand: (cmd: string, val?: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
      {/* Font family */}
      <select
        className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-600 cursor-pointer outline-none"
        onChange={e => { e.preventDefault(); onCommand('fontName', e.target.value); }}
        defaultValue=""
      >
        <option value="" disabled>Font</option>
        {FONT_FAMILIES.map(f => <option key={f.val} value={f.val}>{f.label}</option>)}
      </select>

      {/* Font size */}
      <select
        className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-600 cursor-pointer outline-none"
        onChange={e => { e.preventDefault(); onCommand('fontSize', e.target.value); }}
        defaultValue=""
      >
        <option value="" disabled>Size</option>
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Format buttons */}
      {[
        { cmd: 'bold',          label: <b>B</b>,        title: 'Bold' },
        { cmd: 'italic',        label: <i>I</i>,        title: 'Italic' },
        { cmd: 'underline',     label: <u>U</u>,        title: 'Underline' },
        { cmd: 'strikeThrough', label: <s>S</s>,        title: 'Strike' },
      ].map(btn => (
        <button key={btn.cmd} type="button" title={btn.title}
          onMouseDown={e => { e.preventDefault(); onCommand(btn.cmd); }}
          className="w-7 h-7 flex items-center justify-center text-xs text-gray-600 hover:bg-gray-200 rounded border border-transparent hover:border-gray-300 transition-colors"
        >
          {btn.label}
        </button>
      ))}

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Alignment */}
      {[
        { cmd: 'justifyLeft',   label: '⬛◻◻', title: 'Align Left' },
        { cmd: 'justifyCenter', label: '◻⬛◻', title: 'Align Center' },
        { cmd: 'justifyRight',  label: '◻◻⬛', title: 'Align Right' },
      ].map(btn => (
        <button key={btn.cmd} type="button" title={btn.title}
          onMouseDown={e => { e.preventDefault(); onCommand(btn.cmd); }}
          className="w-7 h-7 flex items-center justify-center text-[10px] text-gray-500 hover:bg-gray-200 rounded border border-transparent hover:border-gray-300 transition-colors"
        >
          {btn.label}
        </button>
      ))}

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Lists */}
      {[
        { cmd: 'insertUnorderedList', label: '• List',  title: 'Bullet List' },
        { cmd: 'insertOrderedList',   label: '1. List', title: 'Numbered List' },
      ].map(btn => (
        <button key={btn.cmd} type="button" title={btn.title}
          onMouseDown={e => { e.preventDefault(); onCommand(btn.cmd); }}
          className="px-2 h-7 flex items-center text-xs text-gray-600 hover:bg-gray-200 rounded border border-transparent hover:border-gray-300 transition-colors"
        >
          {btn.label}
        </button>
      ))}

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Link */}
      <button type="button" title="Insert Link"
        onMouseDown={e => {
          e.preventDefault();
          const url = window.prompt('Enter URL:', 'https://');
          if (url) onCommand('createLink', url);
        }}
        className="px-2 h-7 flex items-center text-xs text-blue-600 hover:bg-blue-50 rounded border border-transparent hover:border-blue-200 transition-colors"
      >
        🔗 Link
      </button>

      {/* Divider */}
      <button type="button" title="Insert Horizontal Rule"
        onMouseDown={e => { e.preventDefault(); onCommand('insertHorizontalRule'); }}
        className="px-2 h-7 flex items-center text-xs text-gray-500 hover:bg-gray-200 rounded border border-transparent hover:border-gray-300"
      >
        ─ HR
      </button>

      {/* Color */}
      <label title="Text Color" className="w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-gray-200 rounded border border-transparent hover:border-gray-300">
        <span className="text-xs font-bold" style={{ color: '#e53e3e' }}>A</span>
        <input type="color" className="w-0 h-0 opacity-0"
          onChange={e => onCommand('foreColor', e.target.value)} />
      </label>

      {/* Highlight */}
      <label title="Highlight Color" className="w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-gray-200 rounded border border-transparent hover:border-gray-300">
        <span className="text-xs font-bold bg-yellow-200 px-0.5">H</span>
        <input type="color" className="w-0 h-0 opacity-0"
          onChange={e => onCommand('backColor', e.target.value)} />
      </label>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Clear */}
      <button type="button" title="Clear formatting"
        onMouseDown={e => { e.preventDefault(); onCommand('removeFormat'); }}
        className="px-2 h-7 flex items-center text-xs text-gray-400 hover:bg-gray-200 rounded border border-transparent hover:border-gray-300"
      >
        ✕ Clear
      </button>
    </div>
  );
}

// ─── Rich Editor ──────────────────────────────────────────────────────────────

function RichEditor({
  value, onChange
}: { value: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'visual' | 'html' | 'preview'>('visual');
  const [htmlSource, setHtmlSource] = useState(value);

  // Sync htmlSource when value changes externally (e.g. template load)
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setHtmlSource(value);
      if (editorRef.current && viewMode === 'visual') {
        editorRef.current.innerHTML = value;
      }
    }
  }, [value, viewMode]);

  const syncFromEditor = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      lastValueRef.current = html;
      onChange(html);
      setHtmlSource(html);
    }
  };

  const execCmd = (cmd: string, val?: string) => {
    // fontSize via style instead of execCommand (deprecated)
    if (cmd === 'fontSize' && val) {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('fontSize', false, '7'); // placeholder
      const spans = editorRef.current?.querySelectorAll<HTMLSpanElement>('font[size="7"]');
      spans?.forEach(s => {
        const span = document.createElement('span');
        span.style.fontSize = val;
        span.innerHTML = s.innerHTML;
        s.replaceWith(span);
      });
    } else if (cmd === 'fontName' && val) {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('fontName', false, val);
    } else {
      document.execCommand('styleWithCSS', false, 'false');
      document.execCommand(cmd, false, val);
    }
    editorRef.current?.focus();
    syncFromEditor();
  };

  const switchTo = (mode: typeof viewMode) => {
    if (mode === viewMode) return;
    if (viewMode === 'visual') syncFromEditor();
    if (viewMode === 'html') { lastValueRef.current = htmlSource; onChange(htmlSource); }

    if (mode === 'visual' && editorRef.current) {
      setTimeout(() => {
        if (editorRef.current) editorRef.current.innerHTML = htmlSource;
      }, 0);
    }
    if (mode === 'html') setHtmlSource(lastValueRef.current);
    setViewMode(mode);
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Tab bar */}
      <div className="flex items-center justify-between bg-gray-50 border-b border-gray-200 px-3">
        <div className="flex gap-0">
          {(['visual', 'html', 'preview'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchTo(m)}
              className={`px-4 py-2.5 text-xs font-semibold capitalize transition-colors border-b-2 ${
                viewMode === m
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {m === 'visual' ? '✏️ Compose' : m === 'html' ? '</> HTML' : '👁 Preview'}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">Tracking pixel injected automatically on send</span>
      </div>

      {/* Toolbar — only in visual mode */}
      {viewMode === 'visual' && <EditorToolbar onCommand={execCmd} />}

      {/* Editor area */}
      {viewMode === 'visual' && (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={syncFromEditor}
          dangerouslySetInnerHTML={{ __html: value }}
          className="min-h-[340px] max-h-[520px] overflow-y-auto px-5 py-4 text-sm text-gray-800 outline-none focus:bg-white"
          style={{ fontFamily: 'sans-serif', lineHeight: '1.7' }}
        />
      )}

      {viewMode === 'html' && (
        <textarea
          className="w-full min-h-[380px] max-h-[520px] px-4 py-3 font-mono text-xs outline-none resize-none bg-gray-900 text-green-300"
          value={htmlSource}
          onChange={e => { setHtmlSource(e.target.value); lastValueRef.current = e.target.value; onChange(e.target.value); }}
          spellCheck={false}
        />
      )}

      {viewMode === 'preview' && (
        <div className="min-h-[380px] max-h-[520px] overflow-y-auto bg-white">
          <div className="bg-gray-100 text-xs text-gray-500 px-4 py-2 border-b border-gray-200">
            Email Preview — as seen in inbox
          </div>
          <iframe
            srcDoc={value || '<p style="color:#aaa;padding:20px">Nothing to preview yet…</p>'}
            className="w-full"
            style={{ minHeight: '360px', border: 'none' }}
            title="Email Preview"
            sandbox="allow-same-origin"
          />
        </div>
      )}
    </div>
  );
}

// ─── Templates ────────────────────────────────────────────────────────────────

const STARTER_TEMPLATES = [
  {
    label: 'Blank',
    html: '<p>Dear {name},</p><p></p><p>Best regards,<br/>Lyra Enterprises</p>',
  },
  {
    label: 'Introduction',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
<div style="background:#1e40af;padding:24px 32px;border-radius:12px 12px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">Lyra Enterprises</h1>
  <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px">Smart Vending Solutions</p>
</div>
<div style="background:#f8fafc;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
  <p style="color:#374151;font-size:15px">Dear <strong>Team</strong>,</p>
  <p style="color:#6b7280;font-size:14px;line-height:1.7">
    We are delighted to introduce ourselves as a leading manufacturer of automated vending machines and smart dispensing solutions.
  </p>
  <a href="https://lyraenterprises.in" style="display:inline-block;margin-top:16px;background:#2563eb;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
    Learn More →
  </a>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
  <p style="color:#9ca3af;font-size:12px;margin:0">Lyra Enterprises · contact@lyraenterprises.in</p>
</div>
</div>`,
  },
  {
    label: 'Follow-up',
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<p style="color:#374151;font-size:15px">Hi <strong>there</strong>,</p>
<p style="color:#6b7280;font-size:14px;line-height:1.7">
  I wanted to follow up on our previous conversation regarding our vending machine solutions.
  Have you had a chance to review the proposal?
</p>
<p style="color:#6b7280;font-size:14px;line-height:1.7">
  I'd love to schedule a quick call to answer any questions and move forward.
</p>
<p style="color:#374151;font-size:14px;margin-top:20px">
  Best regards,<br/>
  <strong>Lyra Enterprises</strong>
</p>
</div>`,
  },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmailComposer() {
  // Compose form
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject,    setSubject]    = useState('');
  const [bodyHtml,   setBodyHtml]   = useState(STARTER_TEMPLATES[0].html);
  const [sending,    setSending]    = useState(false);

  // Campaigns list
  const [campaigns,      setCampaigns]      = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null);
  const [openersLoading,   setOpenersLoading]    = useState(false);
  const [expandedId,       setExpandedId]         = useState<string | null>(null);

  // UI state
  const [activePane, setActivePane] = useState<'compose' | 'campaigns'>('compose');
  const [showTplMenu, setShowTplMenu] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    try {
      const { data } = await api.get('/emailcampaigns');
      setCampaigns(data);
    } catch { toast.error('Failed to load campaigns'); }
    finally { setCampaignsLoading(false); }
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const openOpeners = async (campaignId: string) => {
    setOpenersLoading(true);
    try {
      const { data } = await api.get(`/emailcampaigns/${campaignId}`);
      setSelectedCampaign(data);
    } catch { toast.error('Failed to load campaign detail'); }
    finally { setOpenersLoading(false); }
  };

  const send = async () => {
    if (!recipients.length) { toast.error('Add at least one recipient'); return; }
    if (!subject.trim())    { toast.error('Subject is required'); return; }
    if (!bodyHtml.trim())   { toast.error('Email body is required'); return; }

    setSending(true);
    try {
      const { data } = await api.post('/emailcampaigns/send', {
        subject: subject.trim(),
        body_html: bodyHtml,
        recipients,
      });
      toast.success(`Sent to ${data.sent} recipient${data.sent !== 1 ? 's' : ''}${data.failed ? ` (${data.failed} failed)` : ''}`);
      if (data.errors?.length) {
        data.errors.forEach((e: string) => toast.error(e, { duration: 6000 }));
      }
      // Reset form
      setRecipients([]);
      setSubject('');
      setBodyHtml(STARTER_TEMPLATES[0].html);
      // Reload campaigns
      loadCampaigns();
      setActivePane('campaigns');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const deleteCampaign = async (id: string) => {
    if (!window.confirm('Delete this campaign and its tracking data?')) return;
    try {
      await api.delete(`/emailcampaigns/${id}`);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast.success('Campaign deleted');
    } catch { toast.error('Failed to delete'); }
  };

  // Simulate an open by fetching the pixel endpoint through the Vite proxy.
  // Useful for local testing since email clients can't reach localhost:5000.
  const [simulating, setSimulating] = useState<string | null>(null);
  const simulateOpen = async (campaignId: string, recipientEmail: string) => {
    const key = `${campaignId}-${recipientEmail}`;
    setSimulating(key);
    try {
      await fetch(
        `/api/emailcampaigns/pixel/${campaignId}/${encodeURIComponent(recipientEmail)}.png`,
        { mode: 'no-cors', cache: 'no-store' }
      );
      toast.success('Open simulated!');
      loadCampaigns();
    } catch { toast.error('Simulate failed'); }
    finally { setSimulating(null); }
  };

  // ── Stats ────────────────────────────────────────────────────────────────────
  const totalSent   = campaigns.reduce((s, c) => s + c.sent_count, 0);
  const totalOpens  = campaigns.reduce((s, c) => s + c.open_count, 0);
  const avgOpenRate = totalSent
    ? Math.round((campaigns.filter(c => c.open_count > 0).length / campaigns.length) * 100) : 0;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Email Campaigns</h1>
          <p className="text-sm text-gray-500 mt-0.5">Compose, send and track HTML emails</p>
        </div>
        <button onClick={loadCampaigns} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary stats */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Campaigns',  value: campaigns.length,  icon: <Inbox size={16} />,     color: 'bg-gray-50  border-gray-200',    tc: 'text-gray-800' },
            { label: 'Emails Sent',value: totalSent,         icon: <Send size={16} />,       color: 'bg-blue-50  border-blue-200',    tc: 'text-blue-700' },
            { label: 'Total Opens',value: totalOpens,        icon: <Eye size={16} />,        color: 'bg-green-50 border-green-200',   tc: 'text-green-700' },
            { label: 'Avg Open Rate', value: `${avgOpenRate}%`, icon: <BarChart2 size={16} />, color: 'bg-purple-50 border-purple-200', tc: 'text-purple-700' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border p-4 flex items-start gap-3 ${s.color}`}>
              <div className={`mt-0.5 ${s.tc}`}>{s.icon}</div>
              <div>
                <div className={`text-2xl font-bold ${s.tc}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: 'compose',   label: 'Compose',   icon: <PenSquare size={14} /> },
          { key: 'campaigns', label: 'Sent',       icon: <Inbox size={14} /> },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActivePane(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activePane === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}{t.label}
            {t.key === 'campaigns' && campaigns.length > 0 && (
              <span className="ml-0.5 bg-blue-100 text-blue-700 text-xs font-semibold px-1.5 rounded-full">
                {campaigns.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── COMPOSE PANE ──────────────────────────────────────────────────────── */}
      {activePane === 'compose' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Compose header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2 text-gray-700">
              <Mail size={16} className="text-blue-600" />
              <span className="font-semibold text-sm">New Campaign</span>
            </div>
            {/* Template picker */}
            <div className="relative">
              <button
                onClick={() => setShowTplMenu(v => !v)}
                className="flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              >
                📄 Templates <ChevronDown size={11} />
              </button>
              {showTplMenu && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg min-w-44 py-1">
                  {STARTER_TEMPLATES.map(t => (
                    <button
                      key={t.label}
                      onClick={() => { setBodyHtml(t.html); setShowTplMenu(false); }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* To field */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                <Users size={11} className="inline mr-1" />To
              </label>
              <RecipientInput recipients={recipients} onChange={setRecipients} />
              <p className="text-xs text-gray-400 mt-1">Press Enter, comma, or semicolon after each address. Paste a list to add multiple.</p>
            </div>

            {/* Subject */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Subject</label>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Email subject…"
              />
            </div>

            {/* Rich editor */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Body</label>
              <RichEditor value={bodyHtml} onChange={setBodyHtml} />
            </div>

            {/* Send button */}
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Eye size={11} /> Open tracking injected automatically
              </p>
              <button
                onClick={send}
                disabled={sending}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold shadow-sm shadow-blue-200 transition-colors"
              >
                {sending ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send size={14} /> Send Campaign
                    {recipients.length > 0 && (
                      <span className="bg-blue-500 text-white text-xs px-1.5 rounded-full">{recipients.length}</span>
                    )}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CAMPAIGNS PANE ────────────────────────────────────────────────────── */}
      {activePane === 'campaigns' && (
        <div>
          {campaignsLoading ? (
            <div className="text-center py-12 text-gray-400">Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Mail size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">No campaigns sent yet.</p>
              <button onClick={() => setActivePane('compose')} className="mt-3 text-sm text-blue-500 hover:underline">
                Compose your first campaign →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map(c => {
                const openRate = c.sent_count
                  ? Math.round((c.open_count / c.sent_count) * 100) : 0;
                const isExpanded = expandedId === c.id;

                return (
                  <div key={c.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                    {/* Campaign row */}
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      {/* Expand toggle */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                        className="text-gray-300 hover:text-gray-600 transition-colors shrink-0"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>

                      {/* Subject + date */}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-900 truncate">{c.subject}</div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                          <span className="flex items-center gap-1"><Clock size={10} />{fmtDate(c.created_at)}</span>
                          <span className="flex items-center gap-1"><Users size={10} />{c.recipients.length} recipients</span>
                        </div>
                      </div>

                      {/* Stats chips */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                          <Send size={9} /> {c.sent_count} sent
                        </span>
                        <span className={`flex items-center gap-1 text-xs border px-2 py-0.5 rounded-full font-medium ${
                          c.open_count > 0
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>
                          <Eye size={9} /> {c.open_count} opened
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                          openRate >= 50 ? 'bg-green-50 text-green-700 border-green-200' :
                          openRate >= 20 ? 'bg-amber-50 text-amber-600 border-amber-200' :
                          'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>
                          {openRate}%
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openOpeners(c.id)}
                          disabled={openersLoading}
                          className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-blue-200 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View who opened"
                        >
                          <Eye size={13} /> Openers
                        </button>
                        <button
                          onClick={() => deleteCampaign(c.id)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete campaign"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded recipients list */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recipients</p>
                        <div className="flex flex-wrap gap-1.5">
                          {c.recipients.map(email => (
                            <span key={email} className="inline-flex items-center gap-1.5 text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                              {email}
                              <button
                                onClick={() => simulateOpen(c.id, email)}
                                disabled={simulating === `${c.id}-${email}`}
                                className="text-blue-400 hover:text-blue-700 disabled:opacity-40"
                                title="Simulate open (for local testing)"
                              >
                                {simulating === `${c.id}-${email}` ? '…' : <Eye size={10} />}
                              </button>
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-1.5">Click <Eye size={9} className="inline" /> to simulate an open (local test). In production set <code className="bg-gray-100 px-1 rounded">BACKEND_URL</code> in .env to your server's public URL.</p>

                        {/* Mini progress bar */}
                        <div className="mt-3 flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${openRate >= 50 ? 'bg-green-500' : openRate >= 20 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${openRate}%` }}
                            />
                          </div>
                          <span className={`text-xs font-semibold ${openRateColor(openRate)}`}>{openRate}% open rate</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* New campaign FAB */}
          <div className="flex justify-center mt-5">
            <button
              onClick={() => setActivePane('compose')}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm"
            >
              <Plus size={15} /> New Campaign
            </button>
          </div>
        </div>
      )}

      {/* Openers Modal */}
      <OpenersModal campaign={selectedCampaign} onClose={() => setSelectedCampaign(null)} />
    </div>
  );
}
