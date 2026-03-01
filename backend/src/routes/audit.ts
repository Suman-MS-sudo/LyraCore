import { Router, Response } from 'express';
import db from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate, authorize('management'));

router.get('/', (req: AuthRequest, res: Response) => {
  const { entity_type, entity_id, user_id, limit = 50, offset = 0 } = req.query as any;
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params: any[] = [];

  if (entity_type) { query += ' AND entity_type = ?'; params.push(entity_type); }
  if (entity_id) { query += ' AND entity_id = ?'; params.push(entity_id); }
  if (user_id) { query += ' AND user_id = ?'; params.push(user_id); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const logs = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as count FROM audit_logs WHERE 1=1${entity_type ? ' AND entity_type = ?' : ''}${entity_id ? ' AND entity_id = ?' : ''}`).get(...params.slice(0, -2)) as any;

  res.json({ logs, total: total.count });
});

export default router;
