import { Router, Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import db from '../db/database';
import { nowIST } from '../utils/date';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTransporter() {
  const port = parseInt(process.env.SMTP_PORT || '465');
  const pass = (process.env.SMTP_PASS || '').replace(/^"|"$/g, '');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
    port,
    secure: port === 465,
    auth: { type: 'LOGIN', user: process.env.SMTP_USER || '', pass },
    tls: { rejectUnauthorized: false },
  });
}

// Inject an invisible 1x1 tracking pixel at the end of the HTML body.
function injectTrackingPixel(html: string, campaignId: string, recipientEmail: string, baseUrl: string): string {
  const encoded = encodeURIComponent(recipientEmail);
  const pixelUrl = `${baseUrl}/api/emailcampaigns/pixel/${campaignId}/${encoded}.png`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;outline:none;" alt="" />`;
  // Insert before </body> if present, otherwise append
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return html + pixel;
}

// ─── TRACKING PIXEL ──────────────────────────────────────────────────────────
// GET /api/emailcampaigns/pixel/:campaignId/:email.png  — no auth, called by email clients

router.get('/pixel/:campaignId/:email.png', (req: Request, res: Response) => {
  const { campaignId, email } = req.params;
  const recipientEmail = decodeURIComponent(email);

  // Record open (idempotent per campaign+recipient per hour to avoid double-counting)
  try {
    const recent = db.prepare(
      `SELECT id FROM email_opens
       WHERE campaign_id = ? AND recipient_email = ?
       AND opened_at NOT LIKE '%+05:30'
       AND opened_at > datetime('now', '-1 hour')`
    ).get(campaignId, recipientEmail);

    if (!recent) {
      // Use SQLite's datetime('now') so the opened_at format is consistent
      // with the deduplication comparison (both UTC, SQLite-native format)
      db.prepare(
        `INSERT INTO email_opens (id, campaign_id, recipient_email, opened_at, ip, user_agent)
         VALUES (?, ?, ?, datetime('now'), ?, ?)`
      ).run(
        uuidv4(),
        campaignId,
        recipientEmail,
        req.ip || '',
        req.headers['user-agent'] || ''
      );
    }
  } catch { /* never fail a tracking request */ }

  // Return a 1×1 transparent GIF
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(gif);
});

// ─── SEND CAMPAIGN ────────────────────────────────────────────────────────────
// POST /api/emailcampaigns/send

router.post('/send', authenticate, async (req: AuthRequest, res: Response) => {
  const { subject, body_html, recipients } = req.body as {
    subject: string;
    body_html: string;
    recipients: string[]; // array of email addresses
  };

  if (!subject?.trim())       return res.status(400).json({ error: 'Subject is required' });
  if (!body_html?.trim())     return res.status(400).json({ error: 'Email body is required' });
  if (!Array.isArray(recipients) || recipients.length === 0)
    return res.status(400).json({ error: 'At least one recipient is required' });

  // Validate email format
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalid = recipients.filter(e => !emailRe.test(e?.trim() || ''));
  if (invalid.length) return res.status(400).json({ error: `Invalid email(s): ${invalid.join(', ')}` });

  const campaignId = uuidv4();
  const now = nowIST();
  // Use BACKEND_URL env var so the pixel URL is reachable from external email clients
  const baseUrl = (process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  // Persist campaign first
  db.prepare(
    `INSERT INTO email_campaigns (id, subject, body_html, recipients, sent_count, created_by, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(campaignId, subject.trim(), body_html, JSON.stringify(recipients), req.user?.id || '', now);

  const transporter = createTransporter();
  const fromName  = process.env.COMPANY_NAME || 'Lyra Enterprises';
  const fromEmail = process.env.SMTP_USER || '';
  let sent = 0;
  const errors: string[] = [];

  for (const rawEmail of recipients) {
    const to = rawEmail.trim();
    const trackedHtml = injectTrackingPixel(body_html, campaignId, to, baseUrl);
    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject: subject.trim(),
        html: trackedHtml,
      });
      sent++;
    } catch (err: any) {
      errors.push(`${to}: ${err?.message || 'unknown error'}`);
    }
  }

  // Update sent count
  db.prepare('UPDATE email_campaigns SET sent_count = ? WHERE id = ?').run(sent, campaignId);

  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(campaignId);

  res.status(201).json({
    campaign,
    sent,
    failed: errors.length,
    errors: errors.length ? errors : undefined,
  });
});

// ─── LIST CAMPAIGNS ───────────────────────────────────────────────────────────
// GET /api/emailcampaigns

router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const campaigns = db.prepare(
    `SELECT c.*,
       (SELECT COUNT(DISTINCT recipient_email) FROM email_opens WHERE campaign_id = c.id) AS open_count
     FROM email_campaigns c
     ORDER BY c.created_at DESC`
  ).all();

  const result = (campaigns as any[]).map(c => ({
    ...c,
    recipients: JSON.parse(c.recipients || '[]'),
  }));

  res.json(result);
});

// ─── CAMPAIGN DETAIL + OPENERS ────────────────────────────────────────────────
// GET /api/emailcampaigns/:id

router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(req.params.id) as any;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const opens = db.prepare(
    `SELECT recipient_email, MIN(opened_at) AS first_opened, COUNT(*) AS open_count
     FROM email_opens WHERE campaign_id = ?
     GROUP BY recipient_email
     ORDER BY first_opened DESC`
  ).all(req.params.id);

  res.json({
    ...campaign,
    recipients: JSON.parse(campaign.recipients || '[]'),
    opens,
  });
});

// ─── DELETE CAMPAIGN ──────────────────────────────────────────────────────────
// DELETE /api/emailcampaigns/:id

router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM email_opens WHERE campaign_id = ?').run(req.params.id);
  db.prepare('DELETE FROM email_campaigns WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
