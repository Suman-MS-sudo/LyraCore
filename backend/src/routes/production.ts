import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db, { getNextNumber } from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { auditLog } from '../utils/audit';
import { nowIST, todayIST } from '../utils/date';

const router = Router();
router.use(authenticate);

const qcDir = path.join(__dirname, '../../../uploads/qc_photos');
if (!fs.existsSync(qcDir)) fs.mkdirSync(qcDir, { recursive: true });

const qcStorage = multer.diskStorage({
  destination: qcDir,
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const uploadQC = multer({ storage: qcStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Production Orders ────────────────────────────────────────────────────────

router.get('/', (req: AuthRequest, res: Response) => {
  const { status } = req.query as any;
  let query = `
    SELECT po.*, l.customer_name, l.lead_number, l.product_interest,
           q.amount, q.pi_number, u.name as created_by_name
    FROM production_orders po
    LEFT JOIN leads l ON po.lead_id = l.id
    LEFT JOIN quotations q ON po.quotation_id = q.id
    LEFT JOIN users u ON po.created_by = u.id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (status) { query += ' AND po.status = ?'; params.push(status); }
  query += ' ORDER BY po.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/:id', (req: AuthRequest, res: Response) => {
  const order = db.prepare(`
    SELECT po.*, l.customer_name, l.lead_number, l.product_interest, l.customer_phone, l.customer_email,
           l.delivery_address, l.address, l.location, l.company, l.billing_name, l.gst_number,
           q.amount, q.pi_number, q.payment_confirmed, q.payment_type, q.amount_paid,
           q.discount, q.freight_charges, q.installation_charges, q.payment_terms,
           u.name as created_by_name
    FROM production_orders po
    LEFT JOIN leads l ON po.lead_id = l.id
    LEFT JOIN quotations q ON po.quotation_id = q.id
    LEFT JOIN users u ON po.created_by = u.id
    WHERE po.id = ?
  `).get(req.params.id) as any;

  if (!order) return res.status(404).json({ error: 'Order not found' });

  const fabrication = db.prepare('SELECT * FROM fabrication WHERE production_order_id = ? ORDER BY created_at DESC').get(order.id);
  const assembly = db.prepare('SELECT * FROM assembly WHERE production_order_id = ? ORDER BY created_at DESC').get(order.id);
  const testing = db.prepare('SELECT * FROM testing WHERE production_order_id = ?').get(order.id) as any;
  const qcPhotos = testing ? db.prepare('SELECT * FROM qc_photos WHERE testing_id = ?').all(testing.id) : [];
  const packing = db.prepare('SELECT * FROM packing WHERE production_order_id = ?').get(order.id);
  const dispatch = db.prepare('SELECT * FROM dispatch WHERE production_order_id = ?').get(order.id);
  const installation = db.prepare('SELECT * FROM installation WHERE production_order_id = ?').get(order.id);
  const allocatedSerials = db.prepare('SELECT * FROM order_serials WHERE production_order_id = ? ORDER BY unit_index ASC').all(order.id);

  res.json({ ...order, fabrication, assembly, testing: testing ? { ...testing, qcPhotos } : null, packing, dispatch, installation, allocatedSerials });
});

// POST create production order (triggered after payment confirmation)
router.post('/', authorize('management', 'production', 'sales'), (req: AuthRequest, res: Response) => {
  const { lead_id, quotation_id, expected_delivery_date, priority, notes } = req.body;
  if (!lead_id || !quotation_id) return res.status(400).json({ error: 'lead_id and quotation_id required' });

  // Validate payment confirmed or partial payment
  const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND lead_id = ? AND (payment_confirmed = 1 OR payment_type = \'partial\')').get(quotation_id, lead_id) as any;
  if (!quotation) return res.status(400).json({ error: 'Payment must be confirmed (full or partial) before creating production order' });

  const existing = db.prepare('SELECT id FROM production_orders WHERE lead_id = ?').get(lead_id);
  if (existing) return res.status(400).json({ error: 'Production order already exists for this lead' });

  const id = uuidv4();
  const order_number = getNextNumber('order', 'ORD-');

  const now = nowIST();
  db.prepare(`
    INSERT INTO production_orders (id, order_number, lead_id, quotation_id, expected_delivery_date, priority, created_by, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, order_number, lead_id, quotation_id, expected_delivery_date || null, priority || 'NORMAL', req.user?.id, notes || null, now, now);

  // Initialize stages
  db.prepare(`INSERT INTO assembly (id, production_order_id, created_at, updated_at) VALUES (?,?,?,?)`).run(uuidv4(), id, nowIST(), nowIST());
  db.prepare(`INSERT INTO testing (id, production_order_id, created_at, updated_at) VALUES (?,?,?,?)`).run(uuidv4(), id, nowIST(), nowIST());
  db.prepare(`INSERT INTO packing (id, production_order_id, created_at, updated_at) VALUES (?,?,?,?)`).run(uuidv4(), id, nowIST(), nowIST());
  db.prepare(`INSERT INTO installation (id, production_order_id, created_at, updated_at) VALUES (?,?,?,?)`).run(uuidv4(), id, nowIST(), nowIST());

  auditLog(req.user?.id, req.user?.name, 'CREATE', 'production_order', id, null, { lead_id, order_number }, req.ip);
  res.status(201).json(db.prepare('SELECT * FROM production_orders WHERE id = ?').get(id));
});

// DELETE production order (CEO only)
router.delete('/:id', authorize('management'), (req: AuthRequest, res: Response) => {
  const order = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.id) as any;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // Cascade delete child records
  db.prepare('DELETE FROM qc_photos WHERE testing_id IN (SELECT id FROM testing WHERE production_order_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM fabrication WHERE production_order_id = ?').run(req.params.id);
  db.prepare('DELETE FROM assembly WHERE production_order_id = ?').run(req.params.id);
  db.prepare('DELETE FROM testing WHERE production_order_id = ?').run(req.params.id);
  db.prepare('DELETE FROM packing WHERE production_order_id = ?').run(req.params.id);
  db.prepare('DELETE FROM dispatch WHERE production_order_id = ?').run(req.params.id);
  db.prepare('DELETE FROM installation WHERE production_order_id = ?').run(req.params.id);
  db.prepare('DELETE FROM production_orders WHERE id = ?').run(req.params.id);

  auditLog(req.user?.id, req.user?.name, 'DELETE', 'production_order', req.params.id, { order_number: order.order_number }, null, req.ip);
  res.json({ success: true });
});

// PATCH update production order status
router.patch('/:id/status', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { status, notes } = req.body;
  const old = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.id) as any;
  if (!old) return res.status(404).json({ error: 'Order not found' });

  db.prepare(`UPDATE production_orders SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`)
    .run(status, notes || null, req.params.id);

  auditLog(req.user?.id, req.user?.name, 'STATUS_CHANGE', 'production_order', req.params.id, { status: old.status }, { status }, req.ip);
  res.json(db.prepare('SELECT * FROM production_orders WHERE id = ?').get(req.params.id));
});

// ─── Body Receipt & QC (stored in fabrication table) ─────────────────────────

router.post('/:id/fabrication', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { notes } = req.body;
  const today = todayIST();
  const fabId = uuidv4();
  const fabIst = nowIST();
  db.prepare(`
    INSERT INTO fabrication (id, production_order_id, fabricator_name, sent_date, expected_return_date, notes, updated_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(fabId, req.params.id, 'Body', today, today, notes || null, req.user?.id, fabIst, fabIst);

  db.prepare(`UPDATE production_orders SET status = 'FABRICATION', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(req.params.id);
  auditLog(req.user?.id, req.user?.name, 'BODY_RECEIVED', 'fabrication', fabId, null, { today }, req.ip);
  res.status(201).json(db.prepare('SELECT * FROM fabrication WHERE id = ?').get(fabId));
});

router.patch('/:id/fabrication/:fabId', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { status, received_date, rework_reason, notes } = req.body;
  const old = db.prepare('SELECT * FROM fabrication WHERE id = ?').get(req.params.fabId) as any;
  if (!old) return res.status(404).json({ error: 'Fabrication record not found' });

  db.prepare(`UPDATE fabrication SET status = COALESCE(?, status), received_date = COALESCE(?, received_date), rework_reason = COALESCE(?, rework_reason), notes = COALESCE(?, notes), updated_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`)
    .run(status || null, received_date || null, rework_reason || null, notes || null, req.user?.id, req.params.fabId);

  if (status === 'RECEIVED') {
    db.prepare(`UPDATE production_orders SET status = 'ASSEMBLY', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(req.params.id);
  }
  // REWORK stays at FABRICATION — increment defect_count for tracking
  if (status === 'REWORK') {
    db.prepare(`UPDATE fabrication SET defect_count = defect_count + 1 WHERE id = ?`).run(req.params.fabId);
  }

  auditLog(req.user?.id, req.user?.name, 'FABRICATION_UPDATE', 'fabrication', req.params.fabId, old, req.body, req.ip);
  res.json(db.prepare('SELECT * FROM fabrication WHERE id = ?').get(req.params.fabId));
});

// Reset fabrication to SENT so a new body can be QC'd
router.post('/:id/fabrication/:fabId/replace', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const old = db.prepare('SELECT * FROM fabrication WHERE id = ?').get(req.params.fabId) as any;
  if (!old) return res.status(404).json({ error: 'Fabrication record not found' });
  db.prepare(`UPDATE fabrication SET status = 'SENT', rework_reason = NULL, notes = COALESCE(?, notes), updated_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`)
    .run(req.body.notes || null, req.user?.id, req.params.fabId);
  auditLog(req.user?.id, req.user?.name, 'BODY_REPLACED', 'fabrication', req.params.fabId, old, {}, req.ip);
  res.json(db.prepare('SELECT * FROM fabrication WHERE id = ?').get(req.params.fabId));
});

// ─── Assembly ─────────────────────────────────────────────────────────────────

router.patch('/:id/assembly', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { status, technician, notes } = req.body;
  const assembly = db.prepare('SELECT * FROM assembly WHERE production_order_id = ?').get(req.params.id) as any;
  if (!assembly) return res.status(404).json({ error: 'Assembly record not found' });

  const updates: any = { status, notes, technician, updated_by: req.user?.id };
  if (status === 'IN_PROGRESS' && !assembly.started_at) updates.started_at = nowIST();
  if (status === 'COMPLETED') updates.completed_at = nowIST();

  db.prepare(`UPDATE assembly SET status = COALESCE(?, status), technician = COALESCE(?, technician), notes = COALESCE(?, notes), started_at = COALESCE(started_at, ?), completed_at = COALESCE(?, completed_at), updated_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE production_order_id = ?`)
    .run(status || null, technician || null, notes || null, updates.started_at || null, updates.completed_at || null, req.user?.id, req.params.id);

  if (status === 'COMPLETED') {
    db.prepare(`UPDATE production_orders SET status = 'TESTING', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(req.params.id);
  }

  auditLog(req.user?.id, req.user?.name, 'ASSEMBLY_UPDATE', 'assembly', assembly.id, { status: assembly.status }, { status }, req.ip);
  res.json(db.prepare('SELECT * FROM assembly WHERE production_order_id = ?').get(req.params.id));
});

// ─── Testing & QC ─────────────────────────────────────────────────────────────

router.patch('/:id/testing', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { status, checklist_completed, checklist_data, failure_reason, tested_by, notes } = req.body;
  const testing = db.prepare('SELECT * FROM testing WHERE production_order_id = ?').get(req.params.id) as any;
  if (!testing) return res.status(404).json({ error: 'Testing record not found' });

  db.prepare(`UPDATE testing SET status = COALESCE(?, status), checklist_completed = COALESCE(?, checklist_completed), checklist_data = COALESCE(?, checklist_data), failure_reason = COALESCE(?, failure_reason), tested_by = COALESCE(?, tested_by), notes = COALESCE(?, notes), tested_at = CASE WHEN ? IN ('PASSED','FAILED') THEN datetime('now', '+5 hours', '+30 minutes') ELSE tested_at END, updated_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE production_order_id = ?`)
    .run(status || null, checklist_completed ?? null, checklist_data ? (typeof checklist_data === 'string' ? checklist_data : JSON.stringify(checklist_data)) : null, failure_reason || null, tested_by || null, notes || null, status || null, req.user?.id, req.params.id);

  if (status === 'PASSED') {
    db.prepare(`UPDATE production_orders SET status = 'PACKAGING', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(req.params.id);
  }

  auditLog(req.user?.id, req.user?.name, 'TESTING_UPDATE', 'testing', testing.id, { status: testing.status }, { status }, req.ip);
  res.json(db.prepare('SELECT * FROM testing WHERE production_order_id = ?').get(req.params.id));
});

// ─── Packing ──────────────────────────────────────────────────────────────────

router.patch('/:id/packing', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { status, checklist_data, packed_by, notes } = req.body;
  let packing = db.prepare('SELECT * FROM packing WHERE production_order_id = ?').get(req.params.id) as any;
  // Create packing record on-the-fly for orders created before the feature was added
  if (!packing) {
    const newId = uuidv4();
    db.prepare(`INSERT INTO packing (id, production_order_id, created_at, updated_at) VALUES (?,?,?,?)`).run(newId, req.params.id, nowIST(), nowIST());
    packing = db.prepare('SELECT * FROM packing WHERE id = ?').get(newId) as any;
  }

  db.prepare(`UPDATE packing SET
    status = COALESCE(?, status),
    checklist_data = COALESCE(?, checklist_data),
    packed_by = COALESCE(?, packed_by),
    packed_at = CASE WHEN ? = 'COMPLETED' THEN datetime('now', '+5 hours', '+30 minutes') ELSE packed_at END,
    notes = COALESCE(?, notes),
    updated_by = ?,
    updated_at = datetime('now', '+5 hours', '+30 minutes')
    WHERE production_order_id = ?`)
    .run(status || null, checklist_data ? (typeof checklist_data === 'string' ? checklist_data : JSON.stringify(checklist_data)) : null, packed_by || null, status || null, notes || null, req.user?.id, req.params.id);

  auditLog(req.user?.id, req.user?.name, 'PACKING_UPDATE', 'packing', packing.id, { status: packing.status }, { status }, req.ip);
  res.json(db.prepare('SELECT * FROM packing WHERE production_order_id = ?').get(req.params.id));
});

// POST upload QC photo
router.post('/:id/testing/qc-photo', authorize('production', 'management'), uploadQC.single('photo'), (req: AuthRequest, res: Response) => {
  const testing = db.prepare('SELECT * FROM testing WHERE production_order_id = ?').get(req.params.id) as any;
  if (!testing) return res.status(404).json({ error: 'Testing record not found' });
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

  const id = uuidv4();
  db.prepare('INSERT INTO qc_photos (id, testing_id, file_path, caption, uploaded_by, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, testing.id, `uploads/qc_photos/${req.file.filename}`, req.body.caption || null, req.user?.id, nowIST());

  auditLog(req.user?.id, req.user?.name, 'QC_PHOTO_UPLOAD', 'qc_photo', id, null, { testing_id: testing.id }, req.ip);
  res.status(201).json({ id, file_path: `uploads/qc_photos/${req.file.filename}` });
});

// ─── Serial Number Allocation ─────────────────────────────────────────────────

function skuPrefix(sku: string): string {
  const parts = sku.split('/').filter(p => p && !/^lyra$/i.test(p));
  return (parts.length ? parts.join('-') : sku.replace(/[\/\\]/g, '-')).toUpperCase();
}

// GET: return already-allocated serials for an order
router.get('/:id/serials', (req: AuthRequest, res: Response) => {
  const serials = db.prepare(
    'SELECT * FROM order_serials WHERE production_order_id = ? ORDER BY unit_index ASC'
  ).all(req.params.id);
  res.json(serials);
});

// POST: allocate (idempotent) globally-unique serials for an order
router.post('/:id/serials/allocate', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const orderId = req.params.id;
  const { items } = req.body as { items: { sku: string; name: string; qty: number }[] };
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

  // Return existing allocation if already done (idempotent)
  const existing = db.prepare(
    'SELECT * FROM order_serials WHERE production_order_id = ? ORDER BY unit_index ASC'
  ).all(orderId) as any[];
  if (existing.length > 0) return res.json(existing);

  const now = nowIST();
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const result: any[] = [];
  let unitIdx = 0;

  for (const item of items) {
    const prefix = skuPrefix(item.sku || item.name);
    const counterName = `serial:${prefix}`;
    for (let i = 0; i < item.qty; i++) {
      // Atomic counter increment — one slot per unit globally
      db.prepare('INSERT OR IGNORE INTO counters(name, value) VALUES(?, 0)').run(counterName);
      db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(counterName);
      const { value } = db.prepare('SELECT value FROM counters WHERE name = ?').get(counterName) as any;
      const serial = `${prefix}-${yymm}-${String(value).padStart(4, '0')}`;
      const id = uuidv4();
      const label = item.qty > 1 ? `${item.name} #${i + 1}` : item.name;

      db.prepare(
        'INSERT INTO order_serials (id, production_order_id, unit_index, sku, unit_label, serial_number, allocated_at) VALUES (?,?,?,?,?,?,?)'
      ).run(id, orderId, unitIdx, item.sku, label, serial, now);

      result.push({ id, unit_index: unitIdx, sku: item.sku, unit_label: label, serial_number: serial });
      unitIdx++;
    }
  }

  auditLog(req.user?.id, req.user?.name, 'ALLOCATE_SERIALS', 'order_serials', orderId, null, { count: result.length }, req.ip);
  res.status(201).json(result);
});

export default router;
