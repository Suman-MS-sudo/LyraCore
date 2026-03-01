import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db, { getNextNumber } from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { auditLog } from '../utils/audit';
import { nowIST } from '../utils/date';

const router = Router();
router.use(authenticate);

// GET all leads (filtered by role)
router.get('/', (req: AuthRequest, res: Response) => {
  const { status, search, assigned_to } = req.query as any;
  let query = `
    SELECT l.*, u1.name as assigned_name, u2.name as created_name
    FROM leads l
    LEFT JOIN users u1 ON l.assigned_to = u1.id
    LEFT JOIN users u2 ON l.created_by = u2.id
    WHERE 1=1
  `;
  const params: any[] = [];

  // All roles see all leads

  if (status) { query += ' AND l.status = ?'; params.push(status); }
  if (search) {
    query += ' AND (l.customer_name LIKE ? OR l.company LIKE ? OR l.lead_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (assigned_to && req.user?.role !== 'sales') {
    query += ' AND l.assigned_to = ?';
    params.push(assigned_to);
  }

  query += ' ORDER BY l.created_at DESC';
  const leads = db.prepare(query).all(...params);
  res.json(leads);
});

// GET single lead
router.get('/:id', (req: AuthRequest, res: Response) => {
  const lead = db.prepare(`
    SELECT l.*, u1.name as assigned_name, u2.name as created_name
    FROM leads l
    LEFT JOIN users u1 ON l.assigned_to = u1.id
    LEFT JOIN users u2 ON l.created_by = u2.id
    WHERE l.id = ?
  `).get(req.params.id) as any;

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Get quotations
  const quotations = db.prepare('SELECT * FROM quotations WHERE lead_id = ? ORDER BY created_at DESC').all(lead.id);
  // Get follow-ups
  const followups = db.prepare(`
    SELECT f.*, u.name as user_name FROM followups f
    LEFT JOIN users u ON f.user_id = u.id
    WHERE f.lead_id = ? ORDER BY f.created_at DESC
  `).all(lead.id);
  // Get production order if any
  const production = db.prepare('SELECT * FROM production_orders WHERE lead_id = ?').get(lead.id);

  res.json({ ...lead, quotations, followups, production });
});

// POST create lead
router.post('/', authorize('sales', 'management'), (req: AuthRequest, res: Response) => {
  const {
    customer_name, customer_phone, customer_email, company,
    product_interest, product_type, source, notes, estimated_value, assigned_to,
    location, quantity, purchase_timeline, budget_range, customization_notes, requirement_type, address, delivery_address
  } = req.body;
  if (!customer_name || !customer_phone || !product_interest || !source)
    return res.status(400).json({ error: 'Required: customer_name, customer_phone, product_interest, source' });

  const id = uuidv4();
  const lead_number = getNextNumber('lead', 'LEAD-');
  const assignee = assigned_to || req.user?.id;

  const now = nowIST();
  db.prepare(`
    INSERT INTO leads (
      id, lead_number, customer_name, customer_phone, customer_email, company,
      product_interest, product_type, source, assigned_to, created_by,
      notes, estimated_value, location, quantity, purchase_timeline,
      budget_range, customization_notes, requirement_type, address, delivery_address,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, lead_number, customer_name, customer_phone, customer_email || null, company || null,
    product_interest, product_type || null, source, assignee, req.user?.id,
    notes || null, estimated_value || null, location || null, quantity || null,
    purchase_timeline || null, budget_range || null, customization_notes || null,
    requirement_type || 'standard', address || null, delivery_address || null,
    now, now
  );

  auditLog(req.user?.id, req.user?.name, 'CREATE', 'lead', id, null, { customer_name, status: 'NEW' }, req.ip);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  res.status(201).json(lead);
});

// PATCH update lead
router.patch('/:id', authorize('sales', 'management'), (req: AuthRequest, res: Response) => {
  const old = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id) as any;
  if (!old) return res.status(404).json({ error: 'Lead not found' });
  if (req.user?.role === 'sales' && old.assigned_to !== req.user.id)
    return res.status(403).json({ error: 'Access denied' });

  const allowedFields = [
    'customer_name','customer_phone','customer_email','company',
    'product_interest','product_type','source','status','notes','estimated_value','assigned_to',
    'location','quantity','purchase_timeline','budget_range','customization_notes',
    'requirement_type','requirement_confirmed','billing_name','gst_number','delivery_address','lost_reason','address'
  ];
  const updates: string[] = [];
  const values: any[] = [];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  // Auto-set first_contacted_at when status moves to CONTACTED for the first time
  if (req.body.status === 'CONTACTED' && !old.first_contacted_at) {
    updates.push(`first_contacted_at = datetime('now', '+5 hours', '+30 minutes')`);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  updates.push(`updated_at = datetime('now', '+5 hours', '+30 minutes')`);
  values.push(req.params.id);

  db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  auditLog(req.user?.id, req.user?.name, 'UPDATE', 'lead', req.params.id, old, req.body, req.ip);
  res.json(db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id));
});

// DELETE lead (CEO only)
router.delete('/:id', authorize('management'), (req: AuthRequest, res: Response) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  db.prepare('DELETE FROM quotations WHERE lead_id = ?').run(req.params.id);
  db.prepare('DELETE FROM followups WHERE lead_id = ?').run(req.params.id);
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  auditLog(req.user?.id, req.user?.name, 'DELETE', 'lead', req.params.id, lead, null, req.ip);
  res.json({ ok: true });
});

export default router;
