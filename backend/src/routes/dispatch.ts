import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { auditLog } from '../utils/audit';
import { nowIST } from '../utils/date';
import { sendDispatchInvoiceEmail } from '../utils/email';

const router = Router();
router.use(authenticate);

router.get('/', (req: AuthRequest, res: Response) => {
  const dispatches = db.prepare(`
    SELECT d.*, po.order_number, l.customer_name, l.lead_number, l.product_interest
    FROM dispatch d
    LEFT JOIN production_orders po ON d.production_order_id = po.id
    LEFT JOIN leads l ON po.lead_id = l.id
    ORDER BY d.dispatch_date DESC
  `).all();
  res.json(dispatches);
});

router.post('/:orderId', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { transporter, lr_number, dispatch_date, expected_delivery_date, delivery_address, notes } = req.body;
  if (!transporter || !dispatch_date)
    return res.status(400).json({ error: 'transporter and dispatch_date required' });

  const order = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.orderId) as any;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const id = uuidv4();
  const dispNow = nowIST();
  db.prepare(`
    INSERT INTO dispatch (id, production_order_id, transporter, lr_number, dispatch_date, expected_delivery_date, delivery_address, notes, updated_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, req.params.orderId, transporter, lr_number || null, dispatch_date, expected_delivery_date || null, delivery_address || null, notes || null, req.user?.id, dispNow, dispNow);

  db.prepare(`UPDATE production_orders SET status = 'DISPATCHED', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(req.params.orderId);
  auditLog(req.user?.id, req.user?.name, 'DISPATCHED', 'dispatch', id, null, { transporter, lr_number, dispatch_date }, req.ip);
  res.status(201).json(db.prepare('SELECT * FROM dispatch WHERE id = ?').get(id));
});

router.patch('/:orderId/dispatch/:dispatchId', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { status, notes } = req.body;
  const old = db.prepare('SELECT * FROM dispatch WHERE id = ?').get(req.params.dispatchId) as any;
  if (!old) return res.status(404).json({ error: 'Dispatch record not found' });

  db.prepare(`UPDATE dispatch SET status = COALESCE(?, status), notes = COALESCE(?, notes), updated_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`)
    .run(status || null, notes || null, req.user?.id, req.params.dispatchId);

  if (status === 'DELIVERED') {
    db.prepare(`UPDATE production_orders SET status = 'INSTALLATION', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(req.params.orderId);
  }

  auditLog(req.user?.id, req.user?.name, 'DISPATCH_UPDATE', 'dispatch', req.params.dispatchId, old, req.body, req.ip);
  res.json(db.prepare('SELECT * FROM dispatch WHERE id = ?').get(req.params.dispatchId));
});

router.post('/:orderId/send-invoice-email', authorize('production', 'management', 'sales'), async (req: AuthRequest, res: Response) => {
  // fetch full order + quotation + dispatch data
  const order = db.prepare(`
    SELECT po.*, l.customer_name, l.lead_number, l.product_interest, l.customer_phone, l.customer_email,
           l.address, l.delivery_address, l.location, l.company, l.billing_name, l.gst_number,
           q.amount, q.pi_number, q.payment_confirmed, q.payment_type, q.amount_paid,
           q.discount, q.freight_charges, q.installation_charges
    FROM production_orders po
    LEFT JOIN leads l ON po.lead_id = l.id
    LEFT JOIN quotations q ON po.quotation_id = q.id
    WHERE po.id = ?
  `).get(req.params.orderId) as any;

  if (!order) return res.status(404).json({ error: 'Order not found' });

  const dispatch = db.prepare('SELECT * FROM dispatch WHERE production_order_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.orderId) as any;
  if (!dispatch) return res.status(404).json({ error: 'No dispatch record found' });

  const to = order.customer_email;
  if (!to) return res.status(400).json({ error: 'Customer has no email address on record' });

  // clean bare phone-number lines from address
  const cleanAddr = (a: string) =>
    (a || '').split('\n').filter((l: string) => !/^\s*[\d\s\-\+\(\)]{7,15}\s*$/.test(l.trim())).join('\n').trim();

  try {
    await sendDispatchInvoiceEmail({
      to,
      customerName:     order.customer_name,
      billingName:      order.billing_name || order.customer_name,
      companyName:      order.company,
      customerPhone:    order.customer_phone,
      customerEmail:    order.customer_email,
      customerGstin:    order.gst_number,
      billAddress:      cleanAddr(order.address || order.location || ''),
      shipAddress:      cleanAddr(order.delivery_address || dispatch.delivery_address || ''),
      orderNumber:      order.order_number,
      piNumber:         order.pi_number,
      leadNumber:       order.lead_number,
      dispatchDate:     dispatch.dispatch_date,
      transporter:      dispatch.transporter,
      lrNumber:         dispatch.lr_number,
      dispatchNotes:    dispatch.notes,
      productInterest:  order.product_interest || '',
      baseAmount:       Number(order.amount || 0),
      discount:         Number(order.discount || 0),
      freightCharges:   Number(order.freight_charges || 0),
      installationCharges: Number(order.installation_charges || 0),
      paymentType:      order.payment_type,
      amountPaid:       Number(order.amount_paid || 0),
      paymentConfirmed: Boolean(order.payment_confirmed),
    });
    auditLog(req.user?.id, req.user?.name, 'EMAIL_SENT', 'dispatch', dispatch.id, null, { to, type: 'dispatch_invoice' }, req.ip);
    res.json({ success: true, message: `Dispatch invoice sent to ${to}` });
  } catch (err: any) {
    console.error('[Email] dispatch invoice error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
