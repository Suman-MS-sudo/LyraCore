import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { auditLog } from '../utils/audit';
import { nowIST } from '../utils/date';

const router = Router();
router.use(authenticate);

// GET followups for a lead
router.get('/lead/:leadId', (req: AuthRequest, res: Response) => {
  const followups = db.prepare(`
    SELECT f.*, u.name as user_name FROM followups f
    LEFT JOIN users u ON f.user_id = u.id
    WHERE f.lead_id = ? ORDER BY f.created_at DESC
  `).all(req.params.leadId);
  res.json(followups);
});

// GET all due follow-ups for today (sales sees their own, ceo sees all)
router.get('/due', (req: AuthRequest, res: Response) => {
  let query = `
    SELECT f.*, u.name as user_name, l.customer_name, l.lead_number, l.status as lead_status
    FROM followups f
    LEFT JOIN users u ON f.user_id = u.id
    LEFT JOIN leads l ON f.lead_id = l.id
    WHERE f.completed_at IS NULL AND date(f.scheduled_at) <= date('now', '+5 hours', '+30 minutes')
  `;
  const params: any[] = [];
  if (req.user?.role === 'sales') {
    query += ' AND f.user_id = ?';
    params.push(req.user.id);
  }
  query += ' ORDER BY f.scheduled_at ASC';
  res.json(db.prepare(query).all(...params));
});

// POST create follow-up
router.post('/', authorize('sales', 'management'), (req: AuthRequest, res: Response) => {
  const { lead_id, type, notes, scheduled_at, outcome } = req.body;
  if (!lead_id || !type || !notes)
    return res.status(400).json({ error: 'lead_id, type, notes are required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO followups (id, lead_id, user_id, type, notes, scheduled_at, outcome, created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, lead_id, req.user?.id, type, notes, scheduled_at || null, outcome || null, nowIST());

  auditLog(req.user?.id, req.user?.name, 'CREATE', 'followup', id, null, { lead_id, type }, req.ip);
  res.status(201).json(db.prepare('SELECT * FROM followups WHERE id = ?').get(id));
});

// PATCH complete a follow-up
router.patch('/:id/complete', authorize('sales', 'management'), (req: AuthRequest, res: Response) => {
  const { outcome } = req.body;
  db.prepare(`UPDATE followups SET completed_at = datetime('now', '+5 hours', '+30 minutes'), outcome = ? WHERE id = ?`)
    .run(outcome || null, req.params.id);
  auditLog(req.user?.id, req.user?.name, 'COMPLETE', 'followup', req.params.id, null, { outcome }, req.ip);
  res.json(db.prepare('SELECT * FROM followups WHERE id = ?').get(req.params.id));
});

export default router;
