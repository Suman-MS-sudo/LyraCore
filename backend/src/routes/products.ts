import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { auditLog } from '../utils/audit';
import { nowIST } from '../utils/date';

const router = Router();
router.use(authenticate);

// GET all products
router.get('/', (req: AuthRequest, res: Response) => {
  const { active, product_type } = req.query as any;
  let query = 'SELECT * FROM products WHERE 1=1';
  const params: any[] = [];
  if (active !== undefined)    { query += ' AND is_active = ?'; params.push(active === 'false' ? 0 : 1); }
  if (product_type)            { query += ' AND product_type = ?'; params.push(product_type); }
  query += ' ORDER BY product_type, name';
  res.json(db.prepare(query).all(...params));
});

// GET single product
router.get('/:id', (req: AuthRequest, res: Response) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(product);
});

// POST create product (CEO only)
router.post('/', authorize('management'), (req: AuthRequest, res: Response) => {
  const { name, model_code, product_type, description, base_price, specifications } = req.body;
  if (!name || !product_type) return res.status(400).json({ error: 'Name and product_type required' });
  const id = uuidv4();
  const now = nowIST();
  db.prepare(`
    INSERT INTO products (id, name, model_code, product_type, description, base_price, specifications, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, model_code || null, product_type, description || null, base_price || null, specifications || null, now, now);
  auditLog(req.user?.id, req.user?.name, 'CREATE', 'product', id, null, req.body);
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

// PATCH update product (CEO only)
router.patch('/:id', authorize('management'), (req: AuthRequest, res: Response) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) as any;
  if (!product) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'model_code', 'product_type', 'description', 'base_price', 'specifications', 'is_active'];
  const updates: string[] = ["updated_at = datetime('now', '+5 hours', '+30 minutes')"];
  const values: any[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  values.push(req.params.id);
  db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  auditLog(req.user?.id, req.user?.name, 'UPDATE', 'product', req.params.id, product, req.body);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// DELETE product (CEO only)
router.delete('/:id', authorize('management'), (req: AuthRequest, res: Response) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) as any;
  if (!product) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  auditLog(req.user?.id, req.user?.name, 'DELETE', 'product', req.params.id, product, null);
  res.json({ success: true });
});

export default router;
