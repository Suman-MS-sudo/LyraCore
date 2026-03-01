import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { nowIST } from '../utils/date';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'lyracore_secret';

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email) as any;
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// List users — CEO sees all (including inactive), sales/production see active only
router.get('/users', authenticate, (req: AuthRequest, res: Response) => {
  if (!['management', 'sales', 'production', 'installation'].includes(req.user?.role || ''))
    return res.status(403).json({ error: 'Forbidden' });
  if (req.user?.role === 'management') {
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.active,
             e.rfid_tag, e.id AS employee_id
      FROM users u
      LEFT JOIN employees e ON e.user_id = u.id AND e.active = 1
      ORDER BY u.name
    `).all();
    return res.json(users);
  }
  const users = db.prepare('SELECT id, name, email, role FROM users WHERE active = 1 ORDER BY name').all();
  res.json(users);
});

// Create user (Management only)
router.post('/users', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Only Management can create users' });
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: 'All fields required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any;
  if (existing) return res.status(409).json({ error: 'Email already in use' });
  const hash = bcrypt.hashSync(password, 10);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, active, created_at) VALUES (?,?,?,?,?,1,?)').run(id, name, email, hash, role, nowIST());
  res.json({ id, name, email, role, active: 1 });
});

// Update user name/email/role (Management only)
router.patch('/users/:id', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Only Management can edit users' });
  const { name, email, role } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (email) {
    const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.params.id) as any;
    if (dup) return res.status(409).json({ error: 'Email already in use' });
  }
  db.prepare(`
    UPDATE users SET
      name  = COALESCE(?, name),
      email = COALESCE(?, email),
      role  = COALESCE(?, role)
    WHERE id = ?
  `).run(name || null, email || null, role || null, req.params.id);
  res.json({ success: true });
});

// Reset a user's password (CEO only — no email required)
router.patch('/users/:id/reset-password', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Only Management can reset passwords' });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ success: true });
});

// Assign / update RFID tag for a user (Management only)
// Auto-creates an employee record linked to the user if one doesn't exist yet
router.patch('/users/:id/rfid', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tag = req.body.rfid_tag ? String(req.body.rfid_tag).trim().toUpperCase() : null;

  // Check if tag is already taken by another employee
  if (tag) {
    const conflict = db.prepare(
      `SELECT e.id FROM employees e WHERE e.rfid_tag = ? AND (e.user_id != ? OR e.user_id IS NULL)`
    ).get(tag, req.params.id) as any;
    if (conflict) return res.status(409).json({ error: 'RFID tag already assigned to another employee' });
  }

  const existing = db.prepare('SELECT * FROM employees WHERE user_id = ?').get(req.params.id) as any;
  const now = nowIST();

  if (existing) {
    db.prepare('UPDATE employees SET rfid_tag = ?, updated_at = ? WHERE id = ?')
      .run(tag, now, existing.id);
  } else {
    // Auto-create employee record linked to this user
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM employees').get() as any).cnt;
    const emp_code = `EMP${String(count + 1).padStart(3, '0')}`;
    const emp_id = uuidv4();
    db.prepare(
      `INSERT INTO employees (id, employee_code, name, department, rfid_tag, user_id, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(emp_id, emp_code, user.name, null, tag, req.params.id, now, now);
  }

  res.json({ success: true, rfid_tag: tag });
});

// Change own password (any authenticated user)
router.patch('/me/password', authenticate, (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 4)
    return res.status(400).json({ error: 'currentPassword and newPassword (min 4 chars) required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user!.id);
  res.json({ success: true });
});

// Deactivate user (CEO only — soft delete)
router.patch('/users/:id/deactivate', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Only Management can deactivate users' });
  if (req.params.id === req.user?.id)
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Reactivate user (CEO only)
router.patch('/users/:id/reactivate', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Only Management can reactivate users' });
  db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Delete user permanently (CEO only)
router.delete('/users/:id', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Only Management can delete users' });
  if (req.params.id === req.user?.id)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
