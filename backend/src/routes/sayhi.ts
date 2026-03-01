import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import db from '../db/database';
import { nowIST } from '../utils/date';
import nodemailer from 'nodemailer';

const router = Router();
router.use(authenticate);
router.use(authorize('sales', 'management'));

/* â”€â”€â”€ TEMPLATES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/* ─── CONTACTS ─────────────────────────────────────────── */

// GET /api/sayhi/contacts
router.get('/contacts', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT * FROM sayhi_contacts ORDER BY created_at ASC').all();
  res.json(rows);
});

// POST /api/sayhi/contacts  (single)
router.post('/contacts', (req: AuthRequest, res: Response) => {
  const { name='', organization='', place='', contact='', email='', website='', whatsapp='', map='', status='none', comment='' } = req.body;
  const id = uuidv4();
  const now = nowIST();
  db.prepare(
    'INSERT INTO sayhi_contacts (id,name,organization,place,contact,email,website,whatsapp,map,status,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id, name, organization, place, contact, email, website, whatsapp, map, status, comment, now);
  res.json({ id, name, organization, place, contact, email, website, whatsapp, map, status, comment, emails_sent: 0, wa_opened: 0, created_at: now });
});

// POST /api/sayhi/contacts/bulk  (append — deduplicated by contact number or email)
router.post('/contacts/bulk', (req: AuthRequest, res: Response) => {
  const rows: any[] = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Expected array' });

  // Fetch existing phones + emails for dedup
  const existing = db.prepare('SELECT contact, email FROM sayhi_contacts').all() as { contact: string; email: string }[];
  const norm = (s: string) => String(s || '').replace(/\D/g, '');
  const existingPhones = new Set(existing.map(e => norm(e.contact)).filter(Boolean));
  const existingEmails = new Set(existing.map(e => (e.email || '').toLowerCase().trim()).filter(Boolean));

  const insert = db.prepare(
    'INSERT INTO sayhi_contacts (id,name,organization,place,contact,email,website,whatsapp,map,status,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const now = nowIST();
  const inserted: any[] = [];

  for (const r of rows) {
    const phone = norm(r.contact || '');
    const email = (r.email || '').toLowerCase().trim();
    if ((phone && existingPhones.has(phone)) || (email && existingEmails.has(email))) continue;
    const id = uuidv4();
    insert.run(id, r.name||'', r.organization||'', r.place||'', r.contact||'', r.email||'', r.website||'', r.whatsapp||'', r.map||'', 'none', '', now);
    inserted.push({ id, name: r.name||'', organization: r.organization||'', place: r.place||'', contact: r.contact||'', email: r.email||'', website: r.website||'', whatsapp: r.whatsapp||'', map: r.map||'', emails_sent: 0, wa_opened: 0, status: 'none', comment: '', created_at: now });
    if (phone) existingPhones.add(phone);
    if (email) existingEmails.add(email);
  }
  res.json(inserted);
});

// PUT /api/sayhi/contacts/:id
router.put('/contacts/:id', (req: AuthRequest, res: Response) => {
  const { name='', organization='', place='', contact='', email='', website='', whatsapp='', map='', status='none', comment='' } = req.body;
  db.prepare(
    'UPDATE sayhi_contacts SET name=?,organization=?,place=?,contact=?,email=?,website=?,whatsapp=?,map=?,status=?,comment=? WHERE id=?'
  ).run(name, organization, place, contact, email, website, whatsapp, map, status, comment, req.params.id);
  res.json({ ok: true });
});

// PATCH /api/sayhi/contacts/:id  (partial — for inline status/comment updates)
router.patch('/contacts/:id', (req: AuthRequest, res: Response) => {
  const { status, comment } = req.body;
  if (status !== undefined) {
    db.prepare('UPDATE sayhi_contacts SET status=? WHERE id=?').run(status, req.params.id);
  }
  if (comment !== undefined) {
    db.prepare('UPDATE sayhi_contacts SET comment=? WHERE id=?').run(comment, req.params.id);
  }
  res.json({ ok: true });
});

// DELETE /api/sayhi/contacts/all
router.delete('/contacts/all', (_req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM sayhi_contacts').run();
  res.json({ ok: true });
});

// DELETE /api/sayhi/contacts/:id
router.delete('/contacts/:id', (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM sayhi_contacts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/sayhi/contacts/:id/wa-opened
router.post('/contacts/:id/wa-opened', (req: AuthRequest, res: Response) => {
  db.prepare('UPDATE sayhi_contacts SET wa_opened = wa_opened + 1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ─── TEMPLATES ─────────────────────────────────────────── */

// GET /api/sayhi/templates
router.get('/templates', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT * FROM sayhi_templates ORDER BY type, name').all();
  res.json(rows);
});

// POST /api/sayhi/templates
router.post('/templates', (req: AuthRequest, res: Response) => {
  const { name, type, format, subject, body } = req.body;
  if (!name || !type || !body) return res.status(400).json({ error: 'name, type and body required' });
  const id  = uuidv4();
  const now = nowIST();
  const fmt = format === 'html' ? 'html' : 'plain';
  db.prepare(
    'INSERT INTO sayhi_templates (id, name, type, format, subject, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, name, type, fmt, subject || null, body, now, now);
  res.json({ id, name, type, format: fmt, subject, body, created_at: now, updated_at: now });
});

// PUT /api/sayhi/templates/:id
router.put('/templates/:id', (req: AuthRequest, res: Response) => {
  const { name, type, format, subject, body } = req.body;
  const fmt = format === 'html' ? 'html' : 'plain';
  const now = nowIST();
  db.prepare(
    'UPDATE sayhi_templates SET name=?, type=?, format=?, subject=?, body=?, updated_at=? WHERE id=?'
  ).run(name, type, fmt, subject || null, body, now, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/sayhi/templates/:id
router.delete('/templates/:id', (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM sayhi_templates WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* â”€â”€â”€ SEND EMAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

// POST /api/sayhi/send-email
router.post('/send-email', async (req: AuthRequest, res: Response) => {
  const { to, subject, body, isHtml, contactId } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject and body required' });

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return res.status(500).json({ error: 'Email not configured' });
  }

  const coName  = process.env.COMPANY_NAME || 'Lyra Enterprises';
  const port    = parseInt(process.env.SMTP_PORT || '465');
  const pass    = (process.env.SMTP_PASS || '').replace(/^"|"$/g, '');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
    port,
    secure: port === 465,
    auth: { type: 'LOGIN', user: process.env.SMTP_USER, pass },
    tls: { rejectUnauthorized: false },
  });

  let htmlBody: string;
  if (isHtml) {
    // Use body as raw HTML — wrap in minimal shell only if not already a full document
    htmlBody = body.trimStart().toLowerCase().startsWith('<!doctype') || body.trimStart().toLowerCase().startsWith('<html')
      ? body
      : `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:680px;margin:0 auto;padding:24px;">${body}</body></html>`;
  } else {
    // Plain text — convert line breaks to <br/> and wrap
    htmlBody = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:600px;margin:0 auto;padding:24px;">
    ${body.replace(/\n/g, '<br/>')}
    <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb;"/>
    <p style="font-size:11px;color:#9ca3af;margin-top:8px;">${coName}</p>
  </body></html>`;
  }

  // Plain text fallback (strip tags)
  const textBody = isHtml ? body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : body;

  try {
    await transporter.sendMail({
      from: `"${coName}" <${process.env.SMTP_USER}>`,
      to,
      bcc: process.env.SMTP_USER,
      subject,
      text: textBody,
      html: htmlBody,
    });
    // Persist the send count to the contact record
    if (contactId) {
      try { db.prepare('UPDATE sayhi_contacts SET emails_sent = emails_sent + 1 WHERE id=?').run(contactId); } catch { /* noop */ }
    }
    res.json({ sent: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Send failed' });
  }
});

export default router;
