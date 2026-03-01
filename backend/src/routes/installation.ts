import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { auditLog } from '../utils/audit';
import { nowIST } from '../utils/date';

const router = Router();
router.use(authenticate);

// GET all installations with order + lead info
router.get('/', (req: AuthRequest, res: Response) => {
  const rows = db.prepare(`
    SELECT i.*,
           po.order_number, po.status as order_status,
           l.customer_name, l.customer_phone, l.customer_email,
           l.product_interest, l.company, l.delivery_address, l.address, l.location,
           q.pi_number
    FROM installation i
    LEFT JOIN production_orders po ON i.production_order_id = po.id
    LEFT JOIN leads l ON po.lead_id = l.id
    LEFT JOIN quotations q ON po.quotation_id = q.id
    ORDER BY
      CASE i.status WHEN 'PENDING' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
      i.updated_at DESC
  `).all();
  res.json(rows);
});

// POST manually create installation record for an order at INSTALLATION stage
router.post('/', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const { production_order_id } = req.body;
  if (!production_order_id) return res.status(400).json({ error: 'production_order_id required' });
  const order = db.prepare(`SELECT * FROM production_orders WHERE id = ? AND status = 'INSTALLATION'`).get(production_order_id) as any;
  if (!order) return res.status(404).json({ error: 'Order not found or not at INSTALLATION stage' });
  const existing = db.prepare('SELECT id FROM installation WHERE production_order_id = ?').get(production_order_id);
  if (existing) return res.status(409).json({ error: 'Installation record already exists for this order' });
  const id = uuidv4();
  const now = nowIST();
  db.prepare(`INSERT INTO installation (id, production_order_id, status, created_at, updated_at) VALUES (?,?,?,?,?)`).run(id, production_order_id, 'PENDING', now, now);
  auditLog(req.user?.id, req.user?.name, 'INSTALLATION_CREATE', 'installation', id, null, { production_order_id }, req.ip);
  res.json(db.prepare('SELECT * FROM installation WHERE id = ?').get(id));
});

// PATCH update installation status
router.patch('/:orderId', authorize('production', 'management', 'installation'), (req: AuthRequest, res: Response) => {
  const { status, engineer_name, installation_date, support_notes, feedback, rating } = req.body;
  const installation = db.prepare('SELECT * FROM installation WHERE production_order_id = ?').get(req.params.orderId) as any;
  if (!installation) return res.status(404).json({ error: 'Installation record not found' });

  const completedAt = status === 'COMPLETED' ? nowIST() : null;

  db.prepare(`UPDATE installation SET status = COALESCE(?, status), engineer_name = COALESCE(?, engineer_name), installation_date = COALESCE(?, installation_date), support_notes = COALESCE(?, support_notes), feedback = COALESCE(?, feedback), rating = COALESCE(?, rating), completed_at = COALESCE(?, completed_at), updated_by = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE production_order_id = ?`)
    .run(status || null, engineer_name || null, installation_date || null, support_notes || null, feedback || null, rating || null, completedAt, req.user?.id, req.params.orderId);

  if (status === 'COMPLETED') {
    db.prepare(`UPDATE production_orders SET status = 'COMPLETED', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(req.params.orderId);
    db.prepare(`UPDATE leads SET status = 'CLOSED', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = (SELECT lead_id FROM production_orders WHERE id = ?)`).run(req.params.orderId);
  }

  auditLog(req.user?.id, req.user?.name, 'INSTALLATION_UPDATE', 'installation', installation.id, { status: installation.status }, { status }, req.ip);
  res.json(db.prepare('SELECT * FROM installation WHERE production_order_id = ?').get(req.params.orderId));
});

// DELETE installation by id — resets order back to DISPATCHED
router.delete('/:id', authorize('production', 'management'), (req: AuthRequest, res: Response) => {
  const inst = db.prepare('SELECT * FROM installation WHERE id = ?').get(req.params.id) as any;
  if (!inst) return res.status(404).json({ error: 'Installation record not found' });
  db.prepare('DELETE FROM installation WHERE id = ?').run(req.params.id);
  db.prepare(`UPDATE production_orders SET status = 'DISPATCHED', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`).run(inst.production_order_id);
  auditLog(req.user?.id, req.user?.name, 'INSTALLATION_DELETE', 'installation', inst.id, { status: inst.status }, null, req.ip);
  res.json({ success: true });
});

export default router;
