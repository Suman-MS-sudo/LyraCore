import { Router, Response } from 'express';
import db from '../db/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET all customers — unique contacts derived from leads
router.get('/', (req: AuthRequest, res: Response) => {
  const { search } = req.query as any;

  let query = `
    SELECT
      customer_phone                              AS phone,
      MAX(customer_name)                         AS name,
      MAX(customer_email)                        AS email,
      MAX(company)                               AS company,
      MAX(location)                              AS location,
      COUNT(*)                                   AS total_leads,
      SUM(CASE WHEN status NOT IN ('LOST','CLOSED') THEN 1 ELSE 0 END) AS active_leads,
      SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END)               AS closed_leads,
      SUM(CASE WHEN status = 'LOST'   THEN 1 ELSE 0 END)               AS lost_leads,
      SUM(COALESCE(estimated_value, 0))          AS total_value,
      MAX(updated_at)                            AS last_activity,
      MIN(created_at)                            AS first_seen,
      GROUP_CONCAT(DISTINCT status)              AS statuses
    FROM leads
  `;
  const params: any[] = [];

  if (req.user?.role === 'sales') {
    query += ' WHERE assigned_to = ?';
    params.push(req.user.id);
  } else {
    query += ' WHERE 1=1';
  }

  if (search) {
    query += ' AND (customer_name LIKE ? OR customer_phone LIKE ? OR company LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' GROUP BY customer_phone ORDER BY last_activity DESC';
  const customers = db.prepare(query).all(...params);
  res.json(customers);
});

// GET single customer's leads by phone
router.get('/:phone', (req: AuthRequest, res: Response) => {
  const phone = decodeURIComponent(req.params.phone);
  let query = `
    SELECT l.*, u1.name as assigned_name, u2.name as created_name
    FROM leads l
    LEFT JOIN users u1 ON l.assigned_to = u1.id
    LEFT JOIN users u2 ON l.created_by = u2.id
    WHERE l.customer_phone = ?
  `;
  const params: any[] = [phone];

  if (req.user?.role === 'sales') {
    query += ' AND l.assigned_to = ?';
    params.push(req.user.id);
  }

  query += ' ORDER BY l.created_at DESC';
  const leads = db.prepare(query).all(...params);
  if (leads.length === 0) return res.status(404).json({ error: 'Customer not found' });

  let quotationQuery = `
    SELECT
      q.*,
      l.lead_number,
      l.product_interest,
      l.product_type,
      l.status AS lead_status
    FROM quotations q
    INNER JOIN leads l ON l.id = q.lead_id
    WHERE l.customer_phone = ?
  `;
  const quotationParams: any[] = [phone];

  if (req.user?.role === 'sales') {
    quotationQuery += ' AND l.assigned_to = ?';
    quotationParams.push(req.user.id);
  }

  quotationQuery += ' ORDER BY q.created_at DESC';
  const quotations = db.prepare(quotationQuery).all(...quotationParams);

  const customer = {
    phone,
    name:     (leads[0] as any).customer_name,
    email:    (leads[0] as any).customer_email,
    company:  (leads[0] as any).company,
    location: (leads[0] as any).location,
    leads,
    quotations,
  };
  res.json(customer);
});

export default router;
