import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { initializeDatabase } from './db/database';

// Routes
import authRoute from './routes/auth';
import leadsRoute from './routes/leads';
import followupsRoute from './routes/followups';
import quotationsRoute from './routes/quotations';
import productionRoute from './routes/production';
import dispatchRoute from './routes/dispatch';
import installationRoute from './routes/installation';
import dashboardRoute from './routes/dashboard';
import auditRoute from './routes/audit';
import productsRoute from './routes/products';
import customersRoute from './routes/customers';
import sayhiRoute from './routes/sayhi';
import attendanceRoute from './routes/attendance';

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize DB
initializeDatabase();

// Middleware
app.use(cors({ origin: ['https://localhost', 'https://localhost:443', 'http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));
app.use('/data', express.static(path.join(__dirname, '../../data')));

// Routes
app.use('/api/auth', authRoute);
app.use('/api/leads', leadsRoute);
app.use('/api/followups', followupsRoute);
app.use('/api/quotations', quotationsRoute);
app.use('/api/production', productionRoute);
app.use('/api/dispatch', dispatchRoute);
app.use('/api/installation', installationRoute);
app.use('/api/dashboard', dashboardRoute);
app.use('/api/audit', auditRoute);
app.use('/api/products', productsRoute);
app.use('/api/customers', customersRoute);
app.use('/api/sayhi', sayhiRoute);
app.use('/api/attendance', attendanceRoute);

// Health
app.get('/health', (_, res) => res.json({ status: 'OK', time: new Date().toISOString() }));

// Company info (used by frontend invoice preview)
app.get('/api/company-info', (_, res) => res.json({
  name:    process.env.COMPANY_NAME    || 'Lyra Enterprises',
  address: process.env.COMPANY_ADDRESS || '',
  city:    process.env.COMPANY_CITY    || '',
  gstin:   process.env.COMPANY_GSTIN   || '',
  phone:   process.env.COMPANY_PHONE   || '',
  email:   process.env.COMPANY_EMAIL   || process.env.SMTP_USER || '',
  hsn:     process.env.COMPANY_HSN     || '841900',
  bankCompany: process.env.BANK_COMPANY_NAME || process.env.COMPANY_NAME || '',
  bankName:    process.env.BANK_NAME    || '',
  bankAccount: process.env.BANK_ACCOUNT || '',
  bankIfsc:    process.env.BANK_IFSC    || '',
  bankBranch:  process.env.BANK_BRANCH  || '',
  bankUpi:     process.env.BANK_UPI     || '',
}));

app.listen(PORT, () => {
  console.log(`\n✅ LyraCore Backend running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard APIs:  http://localhost:${PORT}/api/dashboard`);
  console.log(`👤 Auth:            http://localhost:${PORT}/api/auth/login`);
});
