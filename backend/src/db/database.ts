import { Database } from 'node-sqlite3-wasm';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, '../../data/lyracore.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const _db = new Database(DB_PATH);

// Compatibility shim that mimics better-sqlite3's prepare() API
function prepare(sql: string) {
  return {
    run: (...args: any[]) => { _db.run(sql, args); },
    get: (...args: any[]): any => _db.get(sql, args),
    all: (...args: any[]): any[] => _db.all(sql, args) as any[],
  };
}

function exec(sql: string) { _db.exec(sql); }

const db = { prepare, exec };
export default db;

export function initializeDatabase() {
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('sales','production','management','installation')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      lead_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      company TEXT,
      product_interest TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'NEW',
      assigned_to TEXT NOT NULL,
      created_by TEXT NOT NULL,
      notes TEXT,
      estimated_value REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS followups (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      notes TEXT NOT NULL,
      scheduled_at TEXT,
      completed_at TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      pi_number TEXT UNIQUE NOT NULL,
      file_path TEXT,
      amount REAL NOT NULL,
      validity_date TEXT,
      payment_terms TEXT,
      payment_confirmed INTEGER NOT NULL DEFAULT 0,
      payment_confirmed_at TEXT,
      payment_confirmed_by TEXT,
      uploaded_by TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS production_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      lead_id TEXT NOT NULL,
      quotation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      expected_delivery_date TEXT,
      created_by TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS fabrication (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      fabricator_name TEXT NOT NULL,
      sent_date TEXT NOT NULL,
      expected_return_date TEXT NOT NULL,
      received_date TEXT,
      status TEXT NOT NULL DEFAULT 'SENT',
      rework_reason TEXT,
      notes TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS assembly (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      started_at TEXT,
      completed_at TEXT,
      technician TEXT,
      notes TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS testing (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      checklist_completed INTEGER NOT NULL DEFAULT 0,
      checklist_data TEXT,
      failure_reason TEXT,
      tested_by TEXT,
      tested_at TEXT,
      notes TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS qc_photos (
      id TEXT PRIMARY KEY,
      testing_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      caption TEXT,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS dispatch (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      transporter TEXT NOT NULL,
      lr_number TEXT,
      dispatch_date TEXT NOT NULL,
      expected_delivery_date TEXT,
      delivery_address TEXT,
      status TEXT NOT NULL DEFAULT 'DISPATCHED',
      notes TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS packing (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      checklist_data TEXT,
      packed_by TEXT,
      packed_at TEXT,
      notes TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS installation (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      engineer_name TEXT,
      installation_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      support_notes TEXT,
      feedback TEXT,
      rating INTEGER,
      completed_at TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      old_values TEXT,
      new_values TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model_code TEXT,
      product_type TEXT NOT NULL,
      description TEXT,
      base_price REAL,
      hsn_sac_code TEXT,
      specifications TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO counters(name, value) VALUES ('lead', 0);
    INSERT OR IGNORE INTO counters(name, value) VALUES ('order', 0);
    INSERT OR IGNORE INTO counters(name, value) VALUES ('pi', 0);
    CREATE TABLE IF NOT EXISTS order_serials (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL,
      unit_index INTEGER NOT NULL,
      sku TEXT NOT NULL,
      unit_label TEXT NOT NULL,
      serial_number TEXT UNIQUE NOT NULL,
      allocated_at TEXT NOT NULL,
      UNIQUE(production_order_id, unit_index)
    );
    CREATE TABLE IF NOT EXISTS sayhi_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('email','whatsapp')),
      format TEXT NOT NULL DEFAULT 'plain',
      subject TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sayhi_contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
      map TEXT NOT NULL DEFAULT '',
      emails_sent INTEGER NOT NULL DEFAULT 0,
      wa_opened INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'none',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      employee_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      department TEXT,
      designation TEXT,
      rfid_tag TEXT UNIQUE,
      user_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    );
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      scan_type TEXT NOT NULL,
      scanned_at TEXT NOT NULL,
      date TEXT NOT NULL,
      device_id TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS email_campaigns (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      recipients TEXT NOT NULL,
      sent_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_opens (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id)
    );
  `);

  // Migration: clean up email_opens with IST-format timestamps (YYYY-MM-DDTHH:MM:SS+05:30)
  // These compare lexicographically > any UTC datetime string, permanently blocking the 1-hour
  // deduplication check and suppressing all subsequent opens for those records.
  try {
    _db.run("DELETE FROM email_opens WHERE opened_at LIKE '%+05:30'");
  } catch { /* table may not exist yet */ }

  // Migration: add format column to sayhi_templates
  try {
    _db.run("ALTER TABLE sayhi_templates ADD COLUMN format TEXT NOT NULL DEFAULT 'plain'");
  } catch { /* already exists */ }

  // Migration: create sayhi_contacts if added after initial setup
  try {
    _db.run(`CREATE TABLE IF NOT EXISTS sayhi_contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
      map TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`);
  } catch { /* already exists */ }

  // Migration: add organization column to sayhi_contacts
  try {
    _db.run("ALTER TABLE sayhi_contacts ADD COLUMN organization TEXT NOT NULL DEFAULT ''");
  } catch { /* already exists */ }

  // Migration: add emails_sent / wa_opened counters to sayhi_contacts
  try { _db.run('ALTER TABLE sayhi_contacts ADD COLUMN emails_sent INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { _db.run('ALTER TABLE sayhi_contacts ADD COLUMN wa_opened INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { _db.run("ALTER TABLE sayhi_contacts ADD COLUMN status TEXT NOT NULL DEFAULT 'none'"); } catch { /* already exists */ }
  try { _db.run("ALTER TABLE sayhi_contacts ADD COLUMN comment TEXT NOT NULL DEFAULT ''"); } catch { /* already exists */ }

  // Migration: add `active` column to users if it was created without it
  try {
    _db.run('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    _db.run('UPDATE users SET active = 1');
  } catch { /* already exists */ }

  // Migration: add SOP fields to leads table
  const sopLeadCols: [string, string][] = [
    ['location',              'TEXT'],
    ['product_type',          'TEXT'],
    ['quantity',              'TEXT'],
    ['purchase_timeline',     'TEXT'],
    ['budget_range',          'TEXT'],
    ['customization_notes',   'TEXT'],
    ['requirement_type',      "TEXT DEFAULT 'standard'"],
    ['requirement_confirmed', 'INTEGER DEFAULT 0'],
    ['billing_name',          'TEXT'],
    ['gst_number',            'TEXT'],
    ['delivery_address',      'TEXT'],
    ['address',               'TEXT'],
    ['first_contacted_at',    'TEXT'],
    ['lost_reason',           'TEXT'],
  ];
  for (const [col, type] of sopLeadCols) {
    try { _db.run(`ALTER TABLE leads ADD COLUMN ${col} ${type}`); } catch { /* exists */ }
  }

  // Migration: add discount + send_email_status to quotations
  const quotationCols: [string, string][] = [
    ['discount',             'REAL DEFAULT 0'],
    ['email_sent',           'INTEGER DEFAULT 0'],
    ['email_sent_at',        'TEXT'],
    ['freight_charges',      'REAL DEFAULT 0'],
    ['installation_charges', 'REAL DEFAULT 0'],
    ['payment_type',         "TEXT DEFAULT NULL"],
    ['amount_paid',          'REAL DEFAULT 0'],
  ];
  for (const [col, type] of quotationCols) {
    try { _db.run(`ALTER TABLE quotations ADD COLUMN ${col} ${type}`); } catch { /* exists */ }
  }

  // Migration: add defect_count to fabrication
  try { _db.run(`ALTER TABLE fabrication ADD COLUMN defect_count INTEGER DEFAULT 0`); } catch { /* exists */ }

  // Migration: create employees + attendance_logs tables (added post-initial-setup)
  _db.run(`CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    employee_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    department TEXT,
    designation TEXT,
    rfid_tag TEXT UNIQUE,
    user_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
  )`);
  // attendance_logs — no CHECK constraint so FAILED_LOGIN / FAILED_OUT can be inserted
  _db.run(`CREATE TABLE IF NOT EXISTS attendance_logs (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    scan_type TEXT NOT NULL,
    scanned_at TEXT NOT NULL,
    date TEXT NOT NULL,
    device_id TEXT,
    notes TEXT
  )`);
  // Migration: if old table had CHECK constraint (IN/OUT only), recreate without it
  try {
    const tbl = (_db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='attendance_logs'`, []) as any)?.sql || '';
    if (tbl.includes("CHECK(scan_type IN ('IN', 'OUT'))")) {
      _db.exec(`
        ALTER TABLE attendance_logs RENAME TO attendance_logs_old;
        CREATE TABLE attendance_logs (
          id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL,
          scan_type TEXT NOT NULL,
          scanned_at TEXT NOT NULL,
          date TEXT NOT NULL,
          device_id TEXT,
          notes TEXT
        );
        INSERT INTO attendance_logs SELECT * FROM attendance_logs_old;
        DROP TABLE attendance_logs_old;
      `);
      console.log('Migrated: attendance_logs CHECK constraint removed.');
    }
  } catch (e) { console.log('attendance_logs migration skipped:', e); }

  // Migration: create packing table if it doesn't exist (for existing DBs)
  _db.run(`CREATE TABLE IF NOT EXISTS packing (
    id TEXT PRIMARY KEY,
    production_order_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    checklist_data TEXT,
    packed_by TEXT,
    packed_at TEXT,
    notes TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
  )`);

  // Migration: rename 'ceo' role to 'management', add 'installation' role
  try {
    const oldRoleCount = (_db.get(`SELECT COUNT(*) as cnt FROM users WHERE role = 'ceo'`, []) as any)?.cnt;
    if (oldRoleCount > 0) {
      _db.run(`ALTER TABLE users RENAME TO users_old_role_migration`);
      _db.run(`CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('sales','production','management','installation')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
      )`);
      _db.exec(`INSERT INTO users SELECT id, name, email, password_hash, CASE WHEN role='ceo' THEN 'management' ELSE role END, active, created_at FROM users_old_role_migration`);
      _db.run(`DROP TABLE users_old_role_migration`);
      console.log('Migrated: ceo role renamed to management.');
    }
  } catch (e) { console.log('Role migration skipped or already done.'); }

  // Migration: add hsn_sac_code to products table
  try {
    _db.run('ALTER TABLE products ADD COLUMN hsn_sac_code TEXT');
  } catch { /* already exists */ }

  // Migration: add gst_rate to products table
  try {
    _db.run('ALTER TABLE products ADD COLUMN gst_rate REAL NOT NULL DEFAULT 18');
  } catch { /* already exists */ }

  console.log('Database initialized successfully.');
}

export function getNextNumber(counterName: string, prefix: string): string {
  _db.run('UPDATE counters SET value = value + 1 WHERE name = ?', [counterName]);
  const row = _db.get('SELECT value FROM counters WHERE name = ?', [counterName]) as any;
  return `${prefix}${String(row.value).padStart(4, '0')}`;
}
