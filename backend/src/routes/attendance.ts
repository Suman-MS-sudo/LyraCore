import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { nowIST, todayIST } from '../utils/date';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── ESP32 / RFID SCAN ENDPOINT ───────────────────────────────────────────────
// Called by ESP32 over HTTP with { tag_uid, device_id? }
// No authentication required — device communicates via device_key header.
// POST /api/attendance/scan
router.post('/scan', (req, res) => {
  const { tag_uid, device_id } = req.body;
  if (!tag_uid) return res.status(400).json({ error: 'tag_uid required' });

  // Look up employee by RFID tag
  const employee = db.prepare(
    'SELECT * FROM employees WHERE rfid_tag = ? AND active = 1'
  ).get(tag_uid.trim().toUpperCase()) as any;

  if (!employee) {
    return res.status(404).json({ error: 'Unknown tag', tag_uid });
  }

  const today = todayIST();

  // Find the last scan for this employee today
  const lastScan = db.prepare(
    `SELECT * FROM attendance_logs
     WHERE employee_id = ? AND date = ?
     ORDER BY scanned_at DESC
     LIMIT 1`
  ).get(employee.id, today) as any;

  // Toggle: no scan or last was OUT → IN, last was IN → OUT
  const scanType: 'IN' | 'OUT' =
    !lastScan || lastScan.scan_type === 'OUT' ? 'IN' : 'OUT';

  const id = uuidv4();
  const now = nowIST();

  db.prepare(
    `INSERT INTO attendance_logs (id, employee_id, scan_type, scanned_at, date, device_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, employee.id, scanType, now, today, device_id || null);

  res.json({
    success: true,
    employee_name: employee.name,
    employee_code: employee.employee_code,
    scan_type: scanType,
    scanned_at: now,
  });
});

// ─── EMPLOYEE CRUD ─────────────────────────────────────────────────────────────

// GET /api/attendance/employees
router.get('/employees', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const employees = db.prepare(
    `SELECT e.*,
       (SELECT scan_type FROM attendance_logs
        WHERE employee_id = e.id AND date = ?
        ORDER BY scanned_at DESC LIMIT 1) AS last_scan_type,
       (SELECT scanned_at FROM attendance_logs
        WHERE employee_id = e.id AND date = ?
        ORDER BY scanned_at DESC LIMIT 1) AS last_scan_at
     FROM employees e
     ORDER BY e.name`
  ).all(todayIST(), todayIST());

  res.json(employees);
});

// POST /api/attendance/employees
router.post('/employees', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const { name, department, designation, rfid_tag, user_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  // Auto-generate employee code
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM employees').get() as any).cnt;
  const employee_code = `EMP${String(count + 1).padStart(3, '0')}`;

  // Normalize RFID tag
  const tag = rfid_tag ? rfid_tag.trim().toUpperCase() : null;
  if (tag) {
    const existing = db.prepare('SELECT id FROM employees WHERE rfid_tag = ?').get(tag) as any;
    if (existing) return res.status(409).json({ error: 'RFID tag already assigned to another employee' });
  }

  const id = uuidv4();
  const now = nowIST();

  db.prepare(
    `INSERT INTO employees (id, employee_code, name, department, designation, rfid_tag, user_id, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, employee_code, name, department || null, designation || null, tag, user_id || null, now, now);

  res.status(201).json(db.prepare('SELECT * FROM employees WHERE id = ?').get(id));
});

// PUT /api/attendance/employees/:id
router.put('/employees/:id', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id) as any;
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const { name, department, designation, rfid_tag, user_id, active } = req.body;
  const tag = rfid_tag !== undefined ? (rfid_tag ? rfid_tag.trim().toUpperCase() : null) : emp.rfid_tag;

  if (tag && tag !== emp.rfid_tag) {
    const existing = db.prepare('SELECT id FROM employees WHERE rfid_tag = ? AND id != ?').get(tag, req.params.id) as any;
    if (existing) return res.status(409).json({ error: 'RFID tag already assigned to another employee' });
  }

  db.prepare(
    `UPDATE employees SET
       name = ?, department = ?, designation = ?, rfid_tag = ?, user_id = ?, active = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    name ?? emp.name,
    department !== undefined ? department : emp.department,
    designation !== undefined ? designation : emp.designation,
    tag,
    user_id !== undefined ? user_id : emp.user_id,
    active !== undefined ? (active ? 1 : 0) : emp.active,
    nowIST(),
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id));
});

// DELETE /api/attendance/employees/:id  (soft-delete)
router.delete('/employees/:id', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  db.prepare('UPDATE employees SET active = 0, updated_at = ? WHERE id = ?')
    .run(nowIST(), req.params.id);

  res.json({ success: true });
});

// ─── ATTENDANCE LOGS ───────────────────────────────────────────────────────────

// GET /api/attendance/today  →  today's full log with employee details
router.get('/today', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const today = todayIST();

  // All active employees with their latest scan today
  const employees = db.prepare(
    `SELECT e.id, e.employee_code, e.name, e.department, e.designation,
       (SELECT scan_type FROM attendance_logs
        WHERE employee_id = e.id AND date = ?
        ORDER BY scanned_at DESC LIMIT 1) AS status,
       (SELECT scanned_at FROM attendance_logs
        WHERE employee_id = e.id AND date = ?
        ORDER BY scanned_at DESC LIMIT 1) AS last_scan_at,
       (SELECT scanned_at FROM attendance_logs
        WHERE employee_id = e.id AND date = ? AND scan_type = 'IN'
        ORDER BY scanned_at ASC LIMIT 1) AS clock_in,
       (SELECT scanned_at FROM attendance_logs
        WHERE employee_id = e.id AND date = ? AND scan_type = 'OUT'
        ORDER BY scanned_at DESC LIMIT 1) AS clock_out
     FROM employees e
     WHERE e.active = 1
     ORDER BY e.name`
  ).all(today, today, today, today);

  res.json({ date: today, employees });
});

// GET /api/attendance/logs?date=YYYY-MM-DD&employee_id=&month=YYYY-MM
router.get('/logs', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const { date, employee_id, month } = req.query as Record<string, string>;
  let whereClauses: string[] = [];
  let params: any[] = [];

  if (date) {
    whereClauses.push('a.date = ?');
    params.push(date);
  } else if (month) {
    whereClauses.push("a.date LIKE ?");
    params.push(`${month}-%`);
  } else {
    // Default: today
    whereClauses.push('a.date = ?');
    params.push(todayIST());
  }

  if (employee_id) {
    whereClauses.push('a.employee_id = ?');
    params.push(employee_id);
  }

  const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const logs = db.prepare(
    `SELECT a.*, e.name AS employee_name, e.employee_code, e.department
     FROM attendance_logs a
     LEFT JOIN employees e ON a.employee_id = e.id
     ${where}
     ORDER BY a.scanned_at DESC`
  ).all(...params);

  res.json(logs);
});

// GET /api/attendance/report?month=YYYY-MM  →  per-employee summary for a month
router.get('/report', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const month = (req.query.month as string) || todayIST().substring(0, 7);

  const rows = db.prepare(
    `SELECT
       e.id AS employee_id, e.employee_code, e.name, e.department,
       COUNT(DISTINCT a.date) AS days_present,
       MIN(CASE WHEN a.scan_type='IN'  THEN a.scanned_at END) AS first_in,
       MAX(CASE WHEN a.scan_type='OUT' THEN a.scanned_at END) AS last_out
     FROM employees e
     LEFT JOIN attendance_logs a ON a.employee_id = e.id AND a.date LIKE ?
     WHERE e.active = 1
     GROUP BY e.id
     ORDER BY e.name`
  ).all(`${month}-%`);

  res.json({ month, report: rows });
});

export default router;
