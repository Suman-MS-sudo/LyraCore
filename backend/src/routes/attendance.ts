import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import cron from 'node-cron';
import db from '../db/database';
import { nowIST, todayIST } from '../utils/date';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// â”€â”€â”€ CRON JOBS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// All times in IST (UTC+5:30). Server may run in UTC so we schedule accordingly.
// 10:00 AM IST = 04:30 AM UTC  â†’ mark employees who never tapped IN as FAILED_LOGIN
// 06:00 PM IST = 12:30 PM UTC  â†’ mark employees who tapped IN but never OUT as FAILED_OUT

cron.schedule('30 4 * * *', () => {
  const today = todayIST();
  console.log(`[Attendance Cron] 10:00 AM IST â€” marking FAILED_LOGIN for ${today}`);
  const employees = db.prepare('SELECT id FROM employees WHERE active = 1').all() as any[];
  for (const emp of employees) {
    const hasIn = db.prepare(
      `SELECT id FROM attendance_logs WHERE employee_id = ? AND date = ? AND scan_type = 'IN' LIMIT 1`
    ).get(emp.id, today);
    if (!hasIn) {
      db.prepare(
        `INSERT INTO attendance_logs (id, employee_id, scan_type, scanned_at, date, notes)
         VALUES (?, ?, 'FAILED_LOGIN', ?, ?, 'No login recorded by 10:00 AM')`
      ).run(uuidv4(), emp.id, nowIST(), today);
    }
  }
}, { timezone: 'UTC' });

cron.schedule('30 12 * * *', () => {
  const today = todayIST();
  console.log(`[Attendance Cron] 06:00 PM IST â€” marking FAILED_OUT for ${today}`);
  const employees = db.prepare('SELECT id FROM employees WHERE active = 1').all() as any[];
  for (const emp of employees) {
    const hasIn = db.prepare(
      `SELECT id FROM attendance_logs WHERE employee_id = ? AND date = ? AND scan_type = 'IN' LIMIT 1`
    ).get(emp.id, today);
    const hasOut = db.prepare(
      `SELECT id FROM attendance_logs WHERE employee_id = ? AND date = ? AND scan_type = 'OUT' LIMIT 1`
    ).get(emp.id, today);
    if (hasIn && !hasOut) {
      db.prepare(
        `INSERT INTO attendance_logs (id, employee_id, scan_type, scanned_at, date, notes)
         VALUES (?, ?, 'FAILED_OUT', ?, ?, 'Did not tap out before 6:00 PM')`
      ).run(uuidv4(), emp.id, nowIST(), today);
    }
  }
}, { timezone: 'UTC' });

// â”€â”€â”€ ESP32 / RFID SCAN ENDPOINT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/attendance/scan  â€” called by ESP32, no auth token needed
router.post('/scan', (req, res) => {
  const { tag_uid, device_id } = req.body;
  if (!tag_uid) return res.status(400).json({ error: 'tag_uid required' });

  const employee = db.prepare(
    'SELECT * FROM employees WHERE rfid_tag = ? AND active = 1'
  ).get(tag_uid.trim().toUpperCase()) as any;

  if (!employee) {
    return res.status(404).json({ error: 'Unknown tag', tag_uid });
  }

  const today    = todayIST();
  const nowStr   = nowIST();
  const nowMs    = Date.now();

  // Find the first IN of today
  const firstIn = db.prepare(
    `SELECT scanned_at FROM attendance_logs
     WHERE employee_id = ? AND date = ? AND scan_type = 'IN'
     ORDER BY scanned_at ASC LIMIT 1`
  ).get(employee.id, today) as any;

  // Find the last real (IN/OUT) scan today
  const lastScan = db.prepare(
    `SELECT * FROM attendance_logs
     WHERE employee_id = ? AND date = ? AND scan_type IN ('IN','OUT')
     ORDER BY scanned_at DESC LIMIT 1`
  ).get(employee.id, today) as any;

  // Determine what type this tap should be
  const shouldBeOut = lastScan && lastScan.scan_type === 'IN';

  // â”€â”€â”€ 15-min protection: reject early OUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (shouldBeOut && firstIn) {
    const inMs      = new Date(firstIn.scanned_at).getTime();
    const diffMins  = (nowMs - inMs) / 60_000;
    if (diffMins < 15) {
      return res.json({
        success: false,
        rejected: true,
        reason: 'too_early',
        employee_name: employee.name,
        employee_code: employee.employee_code,
        minutes_since_login: Math.floor(diffMins),
        message: `Too early to log out. Wait ${Math.ceil(15 - diffMins)} more minute(s).`,
      });
    }
  }

  const scanType: 'IN' | 'OUT' = shouldBeOut ? 'OUT' : 'IN';
  const id = uuidv4();

  db.prepare(
    `INSERT INTO attendance_logs (id, employee_id, scan_type, scanned_at, date, device_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, employee.id, scanType, nowStr, today, device_id || null);

  res.json({
    success: true,
    rejected: false,
    employee_name: employee.name,
    employee_code: employee.employee_code,
    scan_type: scanType,
    scanned_at: nowStr,
  });
});

// â”€â”€â”€ EMPLOYEE CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/employees', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const employees = db.prepare(
    `SELECT e.*,
       (SELECT scan_type FROM attendance_logs
        WHERE employee_id = e.id AND date = ? AND scan_type IN ('IN','OUT')
        ORDER BY scanned_at DESC LIMIT 1) AS last_scan_type,
       (SELECT scanned_at FROM attendance_logs
        WHERE employee_id = e.id AND date = ? AND scan_type IN ('IN','OUT')
        ORDER BY scanned_at DESC LIMIT 1) AS last_scan_at
     FROM employees e
     ORDER BY e.name`
  ).all(todayIST(), todayIST());

  res.json(employees);
});

router.post('/employees', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const { name, department, designation, rfid_tag, user_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const count = (db.prepare('SELECT COUNT(*) as cnt FROM employees').get() as any).cnt;
  const employee_code = `EMP${String(count + 1).padStart(3, '0')}`;

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
    `UPDATE employees SET name=?, department=?, designation=?, rfid_tag=?, user_id=?, active=?, updated_at=? WHERE id=?`
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

router.delete('/employees/:id', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  db.prepare('UPDATE employees SET active = 0, updated_at = ? WHERE id = ?')
    .run(nowIST(), req.params.id);

  res.json({ success: true });
});

// â”€â”€â”€ ATTENDANCE LOGS & REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/today', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const today = todayIST();

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

router.get('/logs', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const { date, employee_id, month } = req.query as Record<string, string>;
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (date) {
    whereClauses.push('a.date = ?'); params.push(date);
  } else if (month) {
    whereClauses.push('a.date LIKE ?'); params.push(`${month}-%`);
  } else {
    whereClauses.push('a.date = ?'); params.push(todayIST());
  }

  if (employee_id) { whereClauses.push('a.employee_id = ?'); params.push(employee_id); }

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

router.get('/report', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'management')
    return res.status(403).json({ error: 'Management only' });

  const month = (req.query.month as string) || todayIST().substring(0, 7);

  const rows = db.prepare(
    `SELECT
       e.id AS employee_id, e.employee_code, e.name, e.department,
       COUNT(DISTINCT CASE WHEN a.scan_type IN ('IN','OUT') THEN a.date END) AS days_present,
       COUNT(DISTINCT CASE WHEN a.scan_type = 'FAILED_LOGIN' THEN a.date END) AS days_failed_login,
       COUNT(DISTINCT CASE WHEN a.scan_type = 'FAILED_OUT'   THEN a.date END) AS days_failed_out
     FROM employees e
     LEFT JOIN attendance_logs a ON a.employee_id = e.id AND a.date LIKE ?
     WHERE e.active = 1
     GROUP BY e.id
     ORDER BY e.name`
  ).all(`${month}-%`);

  res.json({ month, report: rows });
});

export default router;
