import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db, { getNextNumber } from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { auditLog } from '../utils/audit';
import { sendQuotationEmail, createTransporterForTest } from '../utils/email';
import { nowIST } from '../utils/date';

const router = Router();
router.use(authenticate);

const uploadDir = path.join(__dirname, '../../../uploads/quotations');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// GET test SMTP connection (CEO only)
router.get('/test-smtp', authorize('management'), async (req: AuthRequest, res: Response) => {
  try {
    const t = createTransporterForTest();
    await t.verify();
    res.json({ ok: true, message: 'SMTP connection verified successfully' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET quotations for a lead
router.get('/lead/:leadId', (req: AuthRequest, res: Response) => {
  const quotations = db.prepare('SELECT * FROM quotations WHERE lead_id = ? ORDER BY created_at DESC').all(req.params.leadId);
  res.json(quotations);
});

// GET next PI number preview (without incrementing the counter)
router.get('/next-pi', authorize('sales', 'management'), (req: AuthRequest, res: Response) => {
  const row = db.prepare("SELECT value FROM counters WHERE name = 'pi'").get() as any;
  const next = (row?.value || 0) + 1;
  res.json({ pi_number: `Q-${String(next).padStart(4, '0')}` });
});

// POST create quotation
router.post('/', authorize('sales', 'management'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  const { lead_id, amount, discount, freight_charges, installation_charges, validity_date, payment_terms, notes, send_email } = req.body;
  if (!lead_id || !amount) return res.status(400).json({ error: 'lead_id and amount required' });

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead_id) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (req.user?.role === 'sales' && lead.assigned_to !== req.user.id)
    return res.status(403).json({ error: 'Access denied' });

  const id = uuidv4();
  const pi_number = getNextNumber('pi', 'Q-');
  const file_path = req.file ? `uploads/quotations/${req.file.filename}` : null;
  const discountVal = parseFloat(discount || '0') || 0;
  const amountVal = parseFloat(amount);
  const freightVal = parseFloat(freight_charges || '0') || 0;
  const installationVal = parseFloat(installation_charges || '0') || 0;

  const now = nowIST();
  db.prepare(`
    INSERT INTO quotations (id, lead_id, pi_number, file_path, amount, discount, freight_charges, installation_charges, validity_date, payment_terms, uploaded_by, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, lead_id, pi_number, file_path, amountVal, discountVal, freightVal, installationVal, validity_date || null, payment_terms || null, req.user?.id, notes || null, now, now);

  // Update lead status to QUOTATION_SENT
  db.prepare(`UPDATE leads SET status = 'QUOTATION_SENT', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND status IN ('NEW','CONTACTED','FOLLOW_UP')` ).run(lead_id);

  // Send email if requested and customer has email
  let emailStatus = { sent: false, error: '' };
  if (send_email === 'true' && lead.customer_email) {
    try {
      // Parse pricing
      const subtotalBeforeDiscount = amountVal;
      const afterDiscount = subtotalBeforeDiscount - discountVal;
      const gstAmount = Math.round(afterDiscount * 0.18);
      const freightGst = Math.round(freightVal * 0.18);
      const installGst = Math.round(installationVal * 0.18);
      const grandTotal = afterDiscount + gstAmount
                       + freightVal + freightGst
                       + installationVal + installGst;

      // Build per-item rates and HSN codes from DB products
      const itemRates: Record<string, number> = {};
      const itemHsnCodes: Record<string, string> = {};
      const allProducts = db.prepare('SELECT name, model_code, base_price, hsn_sac_code FROM products WHERE is_active = 1').all() as any[];
      allProducts.forEach((p: any) => {
        if (p.base_price) {
          if (p.model_code) {
            itemRates[p.model_code] = Number(p.base_price);
            itemHsnCodes[p.model_code] = p.hsn_sac_code || '';
          }
          itemRates[p.name] = Number(p.base_price);
          itemHsnCodes[p.name] = p.hsn_sac_code || '';
        }
      });

      await sendQuotationEmail({
        to: lead.customer_email,
        customerName: lead.customer_name,
        companyName: lead.company,
        customerPhone: lead.customer_phone,
        customerGstin: lead.gst_number,
        billingName: lead.billing_name,
        deliveryAddress: lead.delivery_address,
        location: lead.location,
        piNumber: pi_number,
        productInterest: lead.product_interest || '',
        quantity: lead.quantity,
        subtotal: subtotalBeforeDiscount,
        discount: discountVal,
        freightCharges: freightVal,
        installationCharges: installationVal,
        gstAmount,
        grandTotal,
        validityDate: validity_date,
        paymentTerms: payment_terms,
        notes,
        itemRates,
        itemHsnCodes,
      });
      db.prepare(`UPDATE quotations SET email_sent = 1, email_sent_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(id);
      emailStatus = { sent: true, error: '' };
    } catch (err: any) {
      console.error('[Email] SMTP error:', err.message);
      emailStatus = { sent: false, error: err.message };
    }
  } else if (send_email === 'true' && !lead.customer_email) {
    emailStatus = { sent: false, error: 'Customer has no email address on record' };
  }

  auditLog(req.user?.id, req.user?.name, 'CREATE', 'quotation', id, null, { lead_id, pi_number, amount: amountVal }, req.ip);
  const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  res.status(201).json({ ...quotation as object, emailStatus });
});

// PATCH confirm payment (full or partial)
router.patch('/:id/confirm-payment', authorize('sales', 'management'), (req: AuthRequest, res: Response) => {
  const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.params.id) as any;
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

  const { paymentType, amountPaid } = req.body as { paymentType: 'full' | 'partial'; amountPaid?: number };

  if (paymentType === 'partial') {
    const paid = parseFloat(String(amountPaid)) || 0;
    if (paid <= 0) return res.status(400).json({ error: 'Amount paid must be greater than 0' });
    db.prepare(`UPDATE quotations SET payment_confirmed = 0, payment_type = 'partial', amount_paid = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`)
      .run(paid, req.params.id);
    db.prepare(`UPDATE leads SET status = 'PARTIAL_PAYMENT', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(quotation.lead_id);
    auditLog(req.user?.id, req.user?.name, 'PARTIAL_PAYMENT', 'quotation', req.params.id, null, { payment_type: 'partial', amount_paid: paid }, req.ip);
    return res.json({ success: true, message: 'Partial payment recorded.' });
  }

  // Full payment
  db.prepare(`UPDATE quotations SET payment_confirmed = 1, payment_type = 'full', amount_paid = 0, payment_confirmed_at = datetime('now', '+5 hours', '+30 minutes'), payment_confirmed_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`)
    .run(req.user?.id, req.params.id);
  db.prepare(`UPDATE leads SET status = 'PAYMENT_CONFIRMED', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(quotation.lead_id);
  auditLog(req.user?.id, req.user?.name, 'PAYMENT_CONFIRMED', 'quotation', req.params.id, null, { payment_confirmed: true, payment_type: 'full' }, req.ip);
  res.json({ success: true, message: 'Payment confirmed. Production access unlocked.' });
});

// DELETE quotation — blocked if payment has been confirmed
router.delete('/:id', authorize('sales', 'management'), (req: AuthRequest, res: Response) => {
  const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.params.id) as any;
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  if (quotation.payment_confirmed) return res.status(400).json({ error: 'Cannot delete a payment-confirmed quotation' });

  // Delete uploaded file if present
  if (quotation.file_path) {
    const fullPath = path.join(__dirname, '../../../', quotation.file_path);
    try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch { /* ignore */ }
  }

  db.prepare('DELETE FROM quotations WHERE id = ?').run(req.params.id);
  auditLog(req.user?.id, req.user?.name, 'DELETE', 'quotation', req.params.id, { pi_number: quotation.pi_number, amount: quotation.amount }, null, req.ip);
  res.json({ success: true });
});

export default router;
