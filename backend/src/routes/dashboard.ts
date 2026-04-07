import { Router, Response } from 'express';
import db from '../db/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Sales Dashboard
router.get('/sales', (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const role = req.user?.role;
  const filter = role === 'sales' ? 'AND l.assigned_to = ?' : '';
  const params = role === 'sales' ? [userId] : [];

  const leadsByStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM leads l WHERE 1=1 ${filter} GROUP BY status
  `).all(...params);

  const totalLeads = db.prepare(`SELECT COUNT(*) as count FROM leads l WHERE 1=1 ${filter}`).get(...params) as any;
  const closedLeads = db.prepare(`SELECT COUNT(*) as count FROM leads l WHERE status = 'CLOSED' ${filter}`).get(...params) as any;

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(q.amount), 0) as total FROM quotations q
    INNER JOIN leads l ON q.lead_id = l.id
    WHERE q.payment_confirmed = 1 ${filter}
  `).get(...params) as any;

  const pipeline = db.prepare(`
    SELECT COALESCE(SUM(l.estimated_value), 0) as total FROM leads l
    WHERE l.status NOT IN ('CLOSED','LOST') ${filter}
  `).get(...params) as any;

  const dueTodayFollowups = db.prepare(`
    SELECT COUNT(*) as count FROM followups f
    INNER JOIN leads l ON f.lead_id = l.id
    WHERE f.completed_at IS NULL AND date(f.scheduled_at) <= date('now', '+5 hours', '+30 minutes')
    ${role === 'sales' ? 'AND l.assigned_to = ?' : ''}
  `).get(...(role === 'sales' ? [userId] : [])) as any;

  // HOT: NEW leads with no first contact after 5 minutes 
  const hotLeads = db.prepare(`
    SELECT l.*, u.name as assigned_name FROM leads l
    LEFT JOIN users u ON l.assigned_to = u.id
    WHERE l.status = 'NEW'
    AND l.first_contacted_at IS NULL
    AND datetime(l.created_at) <= datetime('now', '+5 hours', '+30 minutes', '-5 minutes')
    ${filter}
    ORDER BY l.created_at ASC
  `).all(...params);

  // Leads needing SOP follow-up (CONTACTED/QUOTATION_SENT with last followup > 1 day ago)
  const needsFollowup = db.prepare(`
    SELECT l.*, u.name as assigned_name,
      MAX(f.created_at) as last_followup_at
    FROM leads l
    LEFT JOIN users u ON l.assigned_to = u.id
    LEFT JOIN followups f ON f.lead_id = l.id AND f.completed_at IS NULL
    WHERE l.status IN ('CONTACTED','QUOTATION_SENT','FOLLOW_UP','NEGOTIATION') ${filter}
    GROUP BY l.id
    HAVING last_followup_at IS NULL OR datetime(last_followup_at) <= datetime('now', '+5 hours', '+30 minutes', '-1 day')
    ORDER BY l.created_at ASC
    LIMIT 10
  `).all(...params);

  const recentLeads = db.prepare(`
    SELECT l.*, u.name as assigned_name FROM leads l
    LEFT JOIN users u ON l.assigned_to = u.id
    WHERE 1=1 ${filter}
    ORDER BY l.created_at DESC LIMIT 5
  `).all(...params);

  res.json({
    leadsByStatus,
    totalLeads: totalLeads.count,
    closedLeads: closedLeads.count,
    conversionRate: totalLeads.count > 0 ? ((closedLeads.count / totalLeads.count) * 100).toFixed(1) : '0',
    revenue: revenue.total,
    pipeline: pipeline.total,
    dueTodayFollowups: dueTodayFollowups.count,
    hotLeads,
    needsFollowup,
    recentLeads
  });
});

// Production Dashboard
router.get('/production', (req: AuthRequest, res: Response) => {
  const ordersByStatus = db.prepare(`SELECT status, COUNT(*) as count FROM production_orders GROUP BY status`).all();
  const totalOrders = db.prepare(`SELECT COUNT(*) as count FROM production_orders`).get() as any;

  const delayedFabrication = db.prepare(`
    SELECT COUNT(*) as count FROM fabrication
    WHERE status = 'SENT' AND date(expected_return_date) < date('now', '+5 hours', '+30 minutes')
  `).get() as any;

  const testingFailures = db.prepare(`
    SELECT COUNT(*) as count FROM testing WHERE status = 'FAILED'
  `).get() as any;

  const pendingDispatch = db.prepare(`
    SELECT COUNT(*) as count FROM production_orders WHERE status = 'PACKAGING'
  `).get() as any;

  const recentOrders = db.prepare(`
    SELECT po.*, l.customer_name, l.product_interest, l.lead_number
    FROM production_orders po
    LEFT JOIN leads l ON po.lead_id = l.id
    ORDER BY po.updated_at DESC LIMIT 8
  `).all();

  const delayedOrders = db.prepare(`
    SELECT po.*, l.customer_name, l.product_interest
    FROM production_orders po
    LEFT JOIN leads l ON po.lead_id = l.id
    WHERE po.expected_delivery_date IS NOT NULL
    AND date(po.expected_delivery_date) < date('now', '+5 hours', '+30 minutes')
    AND po.status NOT IN ('DISPATCHED','INSTALLATION','COMPLETED')
  `).all();

  res.json({
    ordersByStatus,
    totalOrders: totalOrders.count,
    delayedFabrication: delayedFabrication.count,
    testingFailures: testingFailures.count,
    pendingDispatch: pendingDispatch.count,
    recentOrders,
    delayedOrders
  });
});

// CEO / Management Dashboard
router.get('/ceo', (req: AuthRequest, res: Response) => {
  const IST = '+5 hours, +30 minutes';

  // ── Lead KPIs ──
  const leadFunnel = db.prepare(`SELECT status, COUNT(*) as count FROM leads GROUP BY status`).all();
  const totalLeads = db.prepare(`SELECT COUNT(*) as count FROM leads`).get() as any;
  const closedLeads = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'CLOSED'`).get() as any;

  // ── Revenue ──
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM quotations WHERE payment_confirmed = 1`).get() as any;
  const pipeline = db.prepare(`SELECT COALESCE(SUM(estimated_value), 0) as total FROM leads WHERE status NOT IN ('CLOSED','LOST')`).get() as any;

  const monthlyRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM quotations
    WHERE payment_confirmed = 1
    AND strftime('%Y-%m', datetime(created_at, '${IST}')) = strftime('%Y-%m', datetime('now', '${IST}'))
  `).get() as any;

  const lastMonthRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM quotations
    WHERE payment_confirmed = 1
    AND strftime('%Y-%m', datetime(created_at, '${IST}')) = strftime('%Y-%m', datetime('now', '${IST}', '-1 month'))
  `).get() as any;

  // ── Follow-up KPIs ──
  const todayFollowups = db.prepare(`
    SELECT COUNT(*) as count FROM followups
    WHERE completed_at IS NULL AND date(datetime(scheduled_at, '${IST}')) <= date(datetime('now', '${IST}'))
  `).get() as any;

  const overdueFollowupsCount = db.prepare(`
    SELECT COUNT(*) as count FROM followups
    WHERE completed_at IS NULL AND date(datetime(scheduled_at, '${IST}')) < date(datetime('now', '${IST}'))
  `).get() as any;

  // ── Production summary ──
  const productionByStatus = db.prepare(`SELECT status, COUNT(*) as count FROM production_orders GROUP BY status`).all();

  // ── Delayed orders ──
  const delayedOrders = db.prepare(`
    SELECT po.id, po.order_number, l.customer_name, po.expected_delivery_date, po.status
    FROM production_orders po LEFT JOIN leads l ON po.lead_id = l.id
    WHERE po.expected_delivery_date IS NOT NULL
    AND date(datetime(po.expected_delivery_date, '${IST}')) < date(datetime('now', '${IST}'))
    AND po.status NOT IN ('COMPLETED')
    ORDER BY po.expected_delivery_date ASC
  `).all();

  // ── Leads needing attention ──
  const hotLeads = db.prepare(`
    SELECT l.id, l.lead_number, l.customer_name, l.product_interest,
           l.created_at, u.name as assigned_name
    FROM leads l
    LEFT JOIN users u ON l.assigned_to = u.id
    WHERE l.status = 'NEW' AND l.first_contacted_at IS NULL
    AND datetime(l.created_at, '${IST}') <= datetime('now', '${IST}', '-30 minutes')
    ORDER BY l.created_at ASC LIMIT 6
  `).all();

  const needsFollowup = db.prepare(`
    SELECT l.id, l.lead_number, l.customer_name, l.status, l.product_interest,
           u.name as assigned_name,
           MAX(f.scheduled_at) as last_followup_at
    FROM leads l
    LEFT JOIN users u ON l.assigned_to = u.id
    LEFT JOIN followups f ON f.lead_id = l.id AND f.completed_at IS NULL
    WHERE l.status IN ('CONTACTED','QUOTATION_SENT','FOLLOW_UP','NEGOTIATION')
    GROUP BY l.id
    HAVING last_followup_at IS NULL
       OR date(datetime(last_followup_at, '${IST}')) < date(datetime('now', '${IST}'))
    ORDER BY l.created_at ASC LIMIT 6
  `).all();

  const pendingQuotationsCount = db.prepare(`
    SELECT COUNT(*) as count FROM leads WHERE status = 'QUOTATION_SENT'
  `).get() as any;

  // Leads awaiting quotation (CONTACTED with no quotation yet)
  const awaitingQuotation = db.prepare(`
    SELECT l.id, l.lead_number, l.customer_name, l.product_interest,
           u.name as assigned_name, l.created_at
    FROM leads l
    LEFT JOIN users u ON l.assigned_to = u.id
    LEFT JOIN quotations q ON q.lead_id = l.id
    WHERE l.status = 'CONTACTED' AND q.id IS NULL
    ORDER BY l.created_at ASC LIMIT 5
  `).all();

  // ── Recent Orders ──
  const recentOrders = db.prepare(`
    SELECT po.id, po.order_number, po.status, po.created_at, po.expected_delivery_date,
           l.customer_name, l.product_interest, l.lead_number
    FROM production_orders po
    LEFT JOIN leads l ON po.lead_id = l.id
    ORDER BY po.created_at DESC LIMIT 8
  `).all();

  // ── Monthly revenue trend (last 6 months) ──
  const monthlyTrend = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as leads,
           SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) as closed
    FROM leads
    WHERE created_at >= date(datetime('now', '${IST}', '-6 months'))
    GROUP BY month ORDER BY month ASC
  `).all();

  // For pending: only count the latest quotation per lead to avoid double-counting
  // when a lead has multiple revised quotations (e.g. PI-0011 then PI-0012 for same lead).
  const monthlyRevenueTrend = db.prepare(`
    SELECT strftime('%Y-%m', datetime(q.created_at, '${IST}')) as month,
           COALESCE(SUM(CASE WHEN q.payment_confirmed = 1 THEN q.amount ELSE 0 END), 0) as confirmed,
           COALESCE(SUM(CASE WHEN q.payment_confirmed = 0 THEN q.amount ELSE 0 END), 0) as pending
    FROM quotations q
    INNER JOIN (
      SELECT lead_id, MAX(created_at) as latest_at FROM quotations GROUP BY lead_id
    ) latest ON q.lead_id = latest.lead_id AND q.created_at = latest.latest_at
    WHERE q.created_at >= date(datetime('now', '${IST}', '-6 months'))
    GROUP BY month ORDER BY month ASC
  `).all();

  // ── Sales performance ──
  const salesPerformance = db.prepare(`
    SELECT u.name, COUNT(l.id) as total_leads,
           SUM(CASE WHEN l.status = 'CLOSED' THEN 1 ELSE 0 END) as closed,
           SUM(CASE WHEN l.status = 'LOST' THEN 1 ELSE 0 END) as lost,
           COALESCE(SUM(CASE WHEN l.status = 'CLOSED' THEN q.amount ELSE 0 END), 0) as revenue
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
    LEFT JOIN quotations q ON q.lead_id = l.id AND q.payment_confirmed = 1
    WHERE u.role = 'sales' GROUP BY u.id
  `).all();

  // ── Bottlenecks ──
  const avgFabricationDays = db.prepare(`
    SELECT ROUND(AVG(julianday(COALESCE(received_date, date(datetime('now', '${IST}')))) - julianday(sent_date)), 1) as avg_days
    FROM fabrication WHERE status = 'RECEIVED'
  `).get() as any;

  res.json({
    leadFunnel,
    totalLeads: totalLeads.count,
    closedLeads: closedLeads.count,
    conversionRate: totalLeads.count > 0 ? ((closedLeads.count / totalLeads.count) * 100).toFixed(1) : '0',
    revenue: revenue.total,
    pipeline: pipeline.total,
    monthlyRevenue: monthlyRevenue.total,
    lastMonthRevenue: lastMonthRevenue.total,
    todayFollowups: todayFollowups.count,
    overdueFollowupsCount: overdueFollowupsCount.count,
    pendingQuotationsCount: pendingQuotationsCount.count,
    productionByStatus,
    delayedOrders,
    hotLeads,
    needsFollowup,
    awaitingQuotation,
    recentOrders,
    monthlyTrend,
    monthlyRevenueTrend,
    salesPerformance,
    avgFabricationDays: avgFabricationDays?.avg_days || 0
  });
});

// Monthly report with date range filtering
router.get('/monthly-report', (req: AuthRequest, res: Response) => {
  const IST_HOURS = '+5 hours';
  const IST_MINUTES = '+30 minutes';
  const { fromDate, toDate, granularity } = req.query as any;

  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'fromDate and toDate required (YYYY-MM-DD format)' });
  }

  const normalizedGranularity = ['day', 'week', 'month'].includes(String(granularity || '').toLowerCase())
    ? String(granularity).toLowerCase()
    : 'day';

  const bucketExpr = normalizedGranularity === 'month'
    ? `strftime('%Y-%m', datetime(created_at, '${IST_HOURS}', '${IST_MINUTES}'))`
    : normalizedGranularity === 'week'
      ? `strftime('%Y-W%W', datetime(created_at, '${IST_HOURS}', '${IST_MINUTES}'))`
      : `strftime('%Y-%m-%d', datetime(created_at, '${IST_HOURS}', '${IST_MINUTES}'))`;

  const dateFilter = `
    AND datetime(created_at, '${IST_HOURS}', '${IST_MINUTES}') >= datetime('${fromDate}', 'start of day', '${IST_HOURS}', '${IST_MINUTES}')
    AND datetime(created_at, '${IST_HOURS}', '${IST_MINUTES}') <= datetime('${toDate}', 'start of day', '+1 day', '${IST_HOURS}', '${IST_MINUTES}')
  `;

  // Trend data grouped by selected granularity
  const leadsTrend = db.prepare(`
    SELECT
      ${bucketExpr} AS date,
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END), 0) as closed,
      COALESCE(SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END), 0) as lost
    FROM leads
    WHERE 1=1 ${dateFilter}
    GROUP BY ${bucketExpr}
    ORDER BY date ASC
  `).all();

  // Payments trend (quotations with payment_confirmed)
  const paymentsTrend = db.prepare(`
    SELECT
      ${bucketExpr} AS date,
      COUNT(*) as count,
      COALESCE(SUM(amount), 0) as total
    FROM quotations
    WHERE payment_confirmed = 1 ${dateFilter}
    GROUP BY ${bucketExpr}
    ORDER BY date ASC
  `).all();

  // Orders trend
  const ordersTrend = db.prepare(`
    SELECT
      ${bucketExpr} AS date,
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as completed,
      COALESCE(SUM(CASE WHEN status IN ('PENDING','FABRICATION','ASSEMBLY','TESTING','PACKAGING') THEN 1 ELSE 0 END), 0) as in_progress
    FROM production_orders
    WHERE 1=1 ${dateFilter}
    GROUP BY ${bucketExpr}
    ORDER BY date ASC
  `).all();

  // Summary totals
  const leadsSummary = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END), 0) as closed,
      COALESCE(SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END), 0) as lost
    FROM leads
    WHERE 1=1 ${dateFilter}
  `).get() as any;

  const paymentsSummary = db.prepare(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(amount), 0) as total
    FROM quotations
    WHERE payment_confirmed = 1 ${dateFilter}
  `).get() as any;

  const ordersSummary = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as completed
    FROM production_orders
    WHERE 1=1 ${dateFilter}
  `).get() as any;

  const availableRange = db.prepare(`
    SELECT
      MIN(created_date) as minDate,
      MAX(created_date) as maxDate
    FROM (
      SELECT date(datetime(created_at, '${IST_HOURS}', '${IST_MINUTES}')) as created_date FROM leads
      UNION ALL
      SELECT date(datetime(created_at, '${IST_HOURS}', '${IST_MINUTES}')) as created_date FROM quotations
      UNION ALL
      SELECT date(datetime(created_at, '${IST_HOURS}', '${IST_MINUTES}')) as created_date FROM production_orders
    ) all_dates
  `).get() as any;

  res.json({
    period: { fromDate, toDate },
    granularity: normalizedGranularity,
    availableRange,
    leadsTrend,
    paymentsTrend,
    ordersTrend,
    leadsSummary,
    paymentsSummary,
    ordersSummary
  });
});

export default router;
