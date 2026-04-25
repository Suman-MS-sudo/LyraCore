import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { auditLog } from '../utils/audit';
import { nowIST } from '../utils/date';

const router = Router();
router.use(authenticate);

// ── Helper: generate N physical-unit rows, auto-incrementing unit_seq per component ──
function createUnits(
  componentId: string, componentName: string, sku: string | null, count: number
): { id: string; unit_seq: number }[] {
  const now  = nowIST();
  const maxRow = db.prepare('SELECT COALESCE(MAX(unit_seq), 0) as s FROM inventory_units WHERE component_id = ?').get(componentId) as any;
  let seq: number = maxRow.s;
  const units: { id: string; unit_seq: number }[] = [];
  for (let i = 0; i < count; i++) {
    seq++;
    const uid = uuidv4();
    db.prepare(
      'INSERT INTO inventory_units (id, component_id, component_name, sku, unit_seq, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uid, componentId, componentName, sku, seq, now);
    units.push({ id: uid, unit_seq: seq });
  }
  return units;
}

// GET distinct categories (all roles)
router.get('/categories', (req: AuthRequest, res: Response) => {
  const rows = db.prepare(
    'SELECT DISTINCT category FROM inventory_components WHERE category IS NOT NULL ORDER BY category'
  ).all();
  res.json((rows as any[]).map((r) => r.category));
});

// GET dashboard stats (management only)
router.get('/dashboard-stats', authorize('management'), (_req: AuthRequest, res: Response) => {
  const total      = (db.prepare('SELECT COUNT(*) as count FROM inventory_components').get() as any).count;
  const lowStock   = (db.prepare(
    'SELECT COUNT(*) as count FROM inventory_components WHERE quantity > 0 AND quantity <= min_quantity AND min_quantity > 0'
  ).get() as any).count;
  const outOfStock = (db.prepare(
    'SELECT COUNT(*) as count FROM inventory_components WHERE quantity = 0'
  ).get() as any).count;
  const categories = db.prepare(
    'SELECT category, COUNT(*) as count, SUM(quantity) as total_qty FROM inventory_components WHERE category IS NOT NULL GROUP BY category ORDER BY category'
  ).all();
  const recentTransactions = db.prepare(`
    SELECT t.*, c.name AS component_name, c.sku, c.unit
    FROM inventory_transactions t
    JOIN inventory_components c ON c.id = t.component_id
    ORDER BY t.created_at DESC LIMIT 30
  `).all();
  const alertItems = db.prepare(
    'SELECT * FROM inventory_components WHERE quantity = 0 OR (quantity <= min_quantity AND min_quantity > 0) ORDER BY quantity ASC LIMIT 20'
  ).all();
  res.json({ total, lowStock, outOfStock, categories, recentTransactions, alertItems });
});

// GET single unit by UUID — called by mobile scan page
router.get('/unit/:unitId', (req: AuthRequest, res: Response) => {
  const unit = db.prepare(`
    SELECT u.*, c.quantity AS current_stock, c.unit AS stock_unit, c.location, c.min_quantity
    FROM inventory_units u
    JOIN inventory_components c ON c.id = u.component_id
    WHERE u.id = ?
  `).get(req.params.unitId);
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  res.json(unit);
});

// POST use a unit — QR scan → take out 1 physical unit from inventory
router.post('/use-unit/:unitId', (req: AuthRequest, res: Response) => {
  const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(req.params.unitId) as any;
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  if (unit.status === 'used') {
    return res.status(409).json({ error: 'already_used', usedAt: unit.used_at, usedBy: unit.used_by_name });
  }
  if (unit.status === 'failed') {
    return res.status(409).json({ error: 'already_failed', message: 'This unit was marked as defective.' });
  }
  const now       = nowIST();
  const component = db.prepare('SELECT * FROM inventory_components WHERE id = ?').get(unit.component_id) as any;
  const qBefore   = component.quantity;
  const qAfter    = Math.max(0, qBefore - 1);
  db.prepare('UPDATE inventory_units SET status=?, used_at=?, used_by_id=?, used_by_name=? WHERE id=?')
    .run('used', now, req.user!.id, req.user!.name, req.params.unitId);
  db.prepare('UPDATE inventory_components SET quantity=?, updated_at=?, updated_by=? WHERE id=?')
    .run(qAfter, now, req.user!.id, component.id);
  db.prepare(`
    INSERT INTO inventory_transactions
      (id, component_id, user_id, user_name, type, quantity_before, quantity_change, quantity_after, notes, created_at)
    VALUES (?, ?, ?, ?, 'QR_SCAN', ?, -1, ?, ?, ?)
  `).run(
    uuidv4(), component.id, req.user!.id, req.user!.name,
    qBefore, qAfter, `QR scan — unit ${req.params.unitId.slice(0, 8)}`, now
  );
  auditLog(req.user?.id, req.user?.name, 'QR_USE', 'inventory_unit', req.params.unitId, null, { componentId: component.id });
  res.json({ success: true, componentName: component.name, sku: component.sku, unit: component.unit, remainingStock: qAfter });
});

// POST mark unit as defective/failed — removes from available stock
router.post('/fail-unit/:unitId', (req: AuthRequest, res: Response) => {
  const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(req.params.unitId) as any;
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  if (unit.status !== 'available') {
    return res.status(409).json({ error: 'not_available', currentStatus: unit.status });
  }
  const now       = nowIST();
  const component = db.prepare('SELECT * FROM inventory_components WHERE id = ?').get(unit.component_id) as any;
  const qBefore   = component.quantity;
  const qAfter    = Math.max(0, qBefore - 1);
  db.prepare('UPDATE inventory_units SET status=?, used_at=?, used_by_id=?, used_by_name=? WHERE id=?')
    .run('failed', now, req.user!.id, req.user!.name, req.params.unitId);
  db.prepare('UPDATE inventory_components SET quantity=?, updated_at=?, updated_by=? WHERE id=?')
    .run(qAfter, now, req.user!.id, component.id);
  db.prepare(`
    INSERT INTO inventory_transactions
      (id, component_id, user_id, user_name, type, quantity_before, quantity_change, quantity_after, notes, created_at)
    VALUES (?, ?, ?, ?, 'FAILED', ?, -1, ?, ?, ?)
  `).run(
    uuidv4(), component.id, req.user!.id, req.user!.name,
    qBefore, qAfter, `Marked defective — unit ${req.params.unitId.slice(0, 8)}`, now
  );
  auditLog(req.user?.id, req.user?.name, 'FAIL_UNIT', 'inventory_unit', req.params.unitId, null, { componentId: component.id });
  res.json({ success: true, componentName: component.name, remainingStock: qAfter });
});

// GET all components (all roles) — supports ?search= and ?category=
router.get('/', (req: AuthRequest, res: Response) => {
  const { search, category } = req.query as any;
  let query = 'SELECT * FROM inventory_components WHERE 1=1';
  const params: any[] = [];
  if (search) {
    query += ' AND (name LIKE ? OR sku LIKE ? OR category LIKE ? OR description LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (category) { query += ' AND category = ?'; params.push(category); }
  query += ' ORDER BY category, name';
  res.json(db.prepare(query).all(...params));
});

// GET single component (all roles)
router.get('/:id', (req: AuthRequest, res: Response) => {
  const component = db.prepare('SELECT * FROM inventory_components WHERE id = ?').get(req.params.id);
  if (!component) return res.status(404).json({ error: 'Not found' });
  res.json(component);
});

// GET transactions for a component (all roles)
router.get('/:id/transactions', (req: AuthRequest, res: Response) => {
  const rows = db.prepare(
    'SELECT * FROM inventory_transactions WHERE component_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.params.id);
  res.json(rows);
});

// GET units for a component — used for (re-)printing stickers
router.get('/:id/units', (req: AuthRequest, res: Response) => {
  const { status } = req.query as any;
  let sql = 'SELECT * FROM inventory_units WHERE component_id = ?';
  const params: any[] = [req.params.id];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY unit_seq';
  res.json(db.prepare(sql).all(...params));
});

// GET component lifetime stats — purchases, usage, failures
router.get('/:id/stats', (req: AuthRequest, res: Response) => {
  const id  = req.params.id;
  const row = db.prepare(`
    SELECT
      COUNT(*)                                                     AS total_bought,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END)       AS in_stock,
      SUM(CASE WHEN status = 'used'      THEN 1 ELSE 0 END)       AS used_count,
      SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END)       AS failed_count
    FROM inventory_units WHERE component_id = ?
  `).get(id) as any;
  const purchase_history = db.prepare(`
    SELECT * FROM inventory_transactions
    WHERE component_id = ? AND type IN ('INITIAL', 'ADD')
    ORDER BY created_at DESC
  `).all(id);
  res.json({ ...row, purchase_history });
});

// POST create component (management only)
router.post('/', authorize('management'), (req: AuthRequest, res: Response) => {
  const { name, category, sku, description, unit, quantity, min_quantity, location, supplier, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const id  = uuidv4();
  const now = nowIST();
  const qty = Math.max(0, Number(quantity) || 0);
  db.prepare(`
    INSERT INTO inventory_components
      (id, name, category, sku, description, unit, quantity, min_quantity, location, supplier, notes, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, category || null, sku || null, description || null,
    unit || 'pcs', qty, Number(min_quantity) || 0,
    location || null, supplier || null, notes || null,
    req.user!.id, req.user!.id, now, now
  );
  if (qty > 0) {
    db.prepare(`
      INSERT INTO inventory_transactions
        (id, component_id, user_id, user_name, type, quantity_before, quantity_change, quantity_after, notes, created_at)
      VALUES (?, ?, ?, ?, 'INITIAL', 0, ?, ?, 'Initial stock', ?)
    `).run(uuidv4(), id, req.user!.id, req.user!.name, qty, qty, now);
  }
  // Generate one unit row per physical piece — each gets its own QR sticker
  const units = qty > 0 ? createUnits(id, name, sku || null, qty) : [];
  const totalUnits = units.length;
  auditLog(req.user?.id, req.user?.name, 'CREATE', 'inventory_component', id, null, req.body);
  const component = db.prepare('SELECT * FROM inventory_components WHERE id = ?').get(id) as any;
  res.status(201).json({ ...component, units, totalUnits });
});

// PATCH update component
//   - All roles: quantity update (quantity_change + update_type + tx_notes)
//   - Management only: metadata fields (name, category, sku, …)
router.patch('/:id', (req: AuthRequest, res: Response) => {
  const component = db.prepare('SELECT * FROM inventory_components WHERE id = ?').get(req.params.id) as any;
  if (!component) return res.status(404).json({ error: 'Not found' });

  const isManagement = req.user?.role === 'management';
  const now = nowIST();
  const { quantity_change, update_type, tx_notes, ...fields } = req.body;

  const setClauses: string[] = ['updated_by = ?', 'updated_at = ?'];
  const values: any[]        = [req.user!.id, now];

  if (isManagement) {
    const editable = ['name', 'category', 'sku', 'description', 'unit', 'min_quantity', 'location', 'supplier', 'notes'];
    for (const f of editable) {
      if (fields[f] !== undefined) { setClauses.push(`${f} = ?`); values.push(fields[f]); }
    }
  }

  // Quantity change is available to all roles
  if (quantity_change !== undefined) {
    const change  = Number(quantity_change);
    const qBefore = component.quantity;
    const qAfter  = update_type === 'SET' ? Math.max(0, change) : Math.max(0, qBefore + change);
    setClauses.push('quantity = ?');
    values.push(qAfter);
    values.push(req.params.id);
    db.prepare(`UPDATE inventory_components SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    db.prepare(`
      INSERT INTO inventory_transactions
        (id, component_id, user_id, user_name, type, quantity_before, quantity_change, quantity_after, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), req.params.id, req.user!.id, req.user!.name,
      update_type || (change >= 0 ? 'ADD' : 'SUBTRACT'),
      qBefore, change, qAfter, tx_notes || null, now
    );
    // For ADD or SET-increase: generate new unit rows for the added quantity
    const addedCount =
      update_type === 'ADD'                          ? Math.max(0, change) :
      update_type === 'SET' && qAfter > qBefore      ? qAfter - qBefore    : 0;
    const refreshed  = db.prepare('SELECT * FROM inventory_components WHERE id = ?').get(req.params.id) as any;
    const newUnits    = addedCount > 0 ? createUnits(req.params.id, refreshed.name, refreshed.sku || null, addedCount) : [];
    const totalUnits  = (db.prepare('SELECT COUNT(*) as c FROM inventory_units WHERE component_id = ?').get(req.params.id) as any).c;
    if (isManagement) auditLog(req.user?.id, req.user?.name, 'UPDATE', 'inventory_component', req.params.id, component, req.body);
    return res.json(newUnits.length > 0 ? { ...refreshed, newUnits, totalUnits } : refreshed);
  } else {
    if (!isManagement) return res.status(403).json({ error: 'Only management may edit component details' });
    values.push(req.params.id);
    db.prepare(`UPDATE inventory_components SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  if (isManagement) auditLog(req.user?.id, req.user?.name, 'UPDATE', 'inventory_component', req.params.id, component, req.body);
  res.json(db.prepare('SELECT * FROM inventory_components WHERE id = ?').get(req.params.id));
});

// DELETE component (management only)
router.delete('/:id', authorize('management'), (req: AuthRequest, res: Response) => {
  const component = db.prepare('SELECT * FROM inventory_components WHERE id = ?').get(req.params.id) as any;
  if (!component) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM inventory_units WHERE component_id = ?').run(req.params.id);
  db.prepare('DELETE FROM inventory_transactions WHERE component_id = ?').run(req.params.id);
  db.prepare('DELETE FROM inventory_components WHERE id = ?').run(req.params.id);
  auditLog(req.user?.id, req.user?.name, 'DELETE', 'inventory_component', req.params.id, component, null);
  res.json({ success: true });
});

export default router;
