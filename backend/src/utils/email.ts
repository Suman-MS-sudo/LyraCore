import nodemailer from 'nodemailer';
import { nowIST } from './date';
import fs from 'fs';
import path from 'path';

function createTransporter() {
  const port = parseInt(process.env.SMTP_PORT || '465');
  const pass = (process.env.SMTP_PASS || '').replace(/^"|"$/g, '');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
    port,
    secure: port === 465,
    auth: { type: 'LOGIN', user: process.env.SMTP_USER || '', pass },
    tls: { rejectUnauthorized: false },
  });
}

export const createTransporterForTest = createTransporter;

export interface QuotationEmailData {
  to: string;
  customerName: string;
  companyName?: string;
  customerPhone?: string;
  customerGstin?: string;
  billingName?: string;
  deliveryAddress?: string;
  location?: string;
  piNumber: string;
  productInterest: string;
  quantity?: string;
  subtotal: number;
  discount: number;
  freightCharges?: number;
  installationCharges?: number;
  gstAmount: number;
  grandTotal: number;
  validityDate?: string;
  paymentTerms?: string;
  notes?: string;
  itemRates?: Record<string, number>; // modelCode or name → base_price
  itemHsnCodes?: Record<string, string>; // modelCode or name → hsn_sac_code
}

/* ── Formatters ── */
const fmt    = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

/* ── Number to Words (Indian) ── */
const _ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven',
  'Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const _tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function _w(n: number): string {
  if (!n) return '';
  if (n < 20) return _ones[n];
  if (n < 100) return _tens[Math.floor(n/10)] + (n%10 ? ' '+_ones[n%10] : '');
  return _ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' '+_w(n%100) : '');
}
function numberToWords(amount: number): string {
  const n = Math.round(amount);
  if (!n) return 'Zero Rupees Only';
  const cr = Math.floor(n/10000000), lk = Math.floor((n%10000000)/100000),
        th = Math.floor((n%100000)/1000), rm = n%1000;
  return 'Indian Rupee ' + [
    cr ? _w(cr)+' Crore' : '', lk ? _w(lk)+' Lakh' : '',
    th ? _w(th)+' Thousand' : '', rm ? _w(rm) : '',
  ].filter(Boolean).join(' ') + ' Only';
}

/* ── Product row parser ── */
interface Item { name: string; shortName: string; modelCode: string; qty: number; }
function parseItems(s: string): Item[] {
  return s.split(',').map(p => {
    p = p.trim();
    const mFull = p.match(/^(\d+)x\s+(.+?)\s*\(([^)]+)\)/);
    const mSimp = p.match(/^(\d+)x\s+(.+)/);
    if (mFull) return { qty: parseInt(mFull[1]), name: `${mFull[2].trim()} (${mFull[3].trim()})`, shortName: mFull[2].trim(), modelCode: mFull[3].trim() };
    if (mSimp) return { qty: parseInt(mSimp[1]), name: mSimp[2].trim(), shortName: mSimp[2].trim(), modelCode: '' };
    return { qty: 1, name: p, shortName: p, modelCode: '' };
  }).filter(i => i.name);
}

/* ── HTML builder ── */
function buildQuotationHtml(d: QuotationEmailData): string {
  const co = {
    name:    process.env.COMPANY_NAME    || 'Lyra Enterprises',
    address: process.env.COMPANY_ADDRESS || '',
    city:    process.env.COMPANY_CITY    || '',
    gstin:   process.env.COMPANY_GSTIN   || '',
    phone:   process.env.COMPANY_PHONE   || '',
    email:   process.env.COMPANY_EMAIL   || process.env.SMTP_USER || '',
    hsn:     process.env.COMPANY_HSN     || '841900',
  };
  const bank = {
    company: process.env.BANK_COMPANY_NAME || co.name,
    name:    process.env.BANK_NAME    || '',
    account: process.env.BANK_ACCOUNT || '',
    ifsc:    process.env.BANK_IFSC    || '',
    branch:  process.env.BANK_BRANCH  || '',
    upi:     process.env.BANK_UPI     || '',
  };

  const items      = parseItems(d.productInterest);
  const totalQty   = items.reduce((s, i) => s + i.qty, 0) || 1;
  const afterDisc       = d.subtotal - d.discount;
  const freightAmt      = d.freightCharges || 0;
  const installationAmt = d.installationCharges || 0;
  const subTotalExcl    = d.subtotal + freightAmt + installationAmt;
  const taxableBase     = afterDisc + freightAmt + installationAmt;
  const totalGst        = Math.round(taxableBase * 0.18);
  const fallbackRate    = Math.round(d.subtotal / totalQty);

  const getRateForItem = (item: Item): number => {
    if (d.itemRates) {
      if (item.modelCode && d.itemRates[item.modelCode]) return d.itemRates[item.modelCode];
      const key = Object.keys(d.itemRates).find(k => item.shortName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(item.shortName.toLowerCase()));
      if (key) return d.itemRates[key];
    }
    return fallbackRate;
  };

  const getHsnForItem = (item: Item): string => {
    if (d.itemHsnCodes) {
      if (item.modelCode && d.itemHsnCodes[item.modelCode]) return d.itemHsnCodes[item.modelCode];
      const key = Object.keys(d.itemHsnCodes).find(k => item.shortName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(item.shortName.toLowerCase()));
      if (key) return d.itemHsnCodes[key];
    }
    return co.hsn || '841900'; // fallback to company default HSN
  };

  let sno = 0;
  const productRows = items.map(item => {
    sno++;
    const rate    = getRateForItem(item);
    const hsn     = getHsnForItem(item);
    const amt     = rate * item.qty;
    const inclGst = Math.round(amt * 1.18);
    return `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:7px 5px;text-align:center;font-size:12px;">${sno}</td>
      <td style="padding:7px 5px;font-size:12px;font-weight:600;">${item.name}</td>
      <td style="padding:7px 5px;font-size:11px;color:#555;">${item.shortName}</td>
      <td style="padding:7px 5px;text-align:center;font-size:11px;color:#666;">${hsn}</td>
      <td style="padding:7px 5px;text-align:center;font-size:12px;">${item.qty}.00<br/><span style="font-size:10px;color:#888;">nos</span></td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmtInt(rate)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmt(amt)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:600;">${fmt(inclGst)}</td>
    </tr>`;
  }).join('');

  const discRow  = d.discount > 0 ? `<tr><td colspan="7" style="padding:5px 8px;text-align:right;font-size:12px;color:#dc2626;">Less: Discount</td><td style="padding:5px 8px;text-align:right;font-size:12px;color:#dc2626;">− ${fmt(d.discount)}</td></tr>` : '';
  const notesRow = d.notes ? `<tr><td colspan="8" style="padding:8px;font-size:11px;color:#555;border-top:1px solid #e5e7eb;"><strong>Note:</strong> ${d.notes}</td></tr>` : '';

  let extraRows = '';
  if (freightAmt > 0) {
    sno++;
    extraRows += `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:7px 5px;text-align:center;font-size:12px;">${sno}</td>
      <td style="padding:7px 5px;font-size:12px;font-weight:600;">Freight Charges</td>
      <td style="padding:7px 5px;font-size:11px;color:#555;">Logistics &amp; Transportation</td>
      <td style="padding:7px 5px;text-align:center;font-size:11px;color:#666;">996511</td>
      <td style="padding:7px 5px;text-align:center;font-size:12px;">1.00<br/><span style="font-size:10px;color:#888;">lump</span></td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmtInt(freightAmt)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmt(freightAmt)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:600;">${fmt(Math.round(freightAmt * 1.18))}</td>
    </tr>`;
  }
  if (installationAmt > 0) {
    sno++;
    extraRows += `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:7px 5px;text-align:center;font-size:12px;">${sno}</td>
      <td style="padding:7px 5px;font-size:12px;font-weight:600;">Installation Charges</td>
      <td style="padding:7px 5px;font-size:11px;color:#555;">Setup &amp; Commissioning</td>
      <td style="padding:7px 5px;text-align:center;font-size:11px;color:#666;">998721</td>
      <td style="padding:7px 5px;text-align:center;font-size:12px;">1.00<br/><span style="font-size:10px;color:#888;">lump</span></td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmtInt(installationAmt)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmt(installationAmt)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:600;">${fmt(Math.round(installationAmt * 1.18))}</td>
    </tr>`;
  }
  const valRow   = d.validityDate ? `<tr><td style="padding:2px 0;font-size:11px;color:#6b7280;">Valid Until</td><td style="padding:2px 0 2px 10px;font-size:11px;font-weight:600;">${fmtDate(d.validityDate)}</td></tr>` : '';
  const termsRow = d.paymentTerms ? `<tr><td style="padding:2px 0;font-size:11px;color:#6b7280;">Terms</td><td style="padding:2px 0 2px 10px;font-size:11px;">${d.paymentTerms}</td></tr>` : '';

  const shipAddr = d.deliveryAddress || d.location || '';
  const shipCell = shipAddr ? `
    <td style="width:33%;padding:12px 14px;vertical-align:top;border-left:1px solid #e5e7eb;">
      <div style="color:#8B7536;font-size:10px;font-weight:700;margin-bottom:4px;">SHIP TO</div>
      <div style="font-size:11px;color:#374151;line-height:1.7;">${shipAddr.replace(/,\s*/g, '<br/>')}</div>
    </td>` : '<td style="width:33%;"></td>';

  const bankHtml = (bank.account && !bank.account.startsWith('X')) ? `
    <table style="width:100%;border-top:1px solid #e5e7eb;"><tr>
      <td style="padding:12px 16px;vertical-align:top;">
        <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px;">Bank Details — Payment Information</div>
        <div style="font-size:11px;color:#555;line-height:2;">
          Company Name &nbsp;: ${bank.company}<br/>
          ${bank.name    ? `Bank &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${bank.name}<br/>` : ''}
          ${bank.account ? `Account No &nbsp;&nbsp;&nbsp;&nbsp;: <strong style="color:#111;">${bank.account}</strong><br/>` : ''}
          ${bank.ifsc    ? `IFSC Code &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${bank.ifsc}<br/>` : ''}
          ${bank.branch  ? `Branch &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${bank.branch}<br/>` : ''}
          ${bank.upi     ? `UPI ID &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <strong style="color:#111;">${bank.upi}</strong>` : ''}
        </div>
      </td>
      <td style="padding:12px 16px;text-align:center;vertical-align:middle;width:130px;">
        <img src="cid:payment-qr" alt="Scan to Pay" style="width:110px;height:110px;border:1px solid #e5e7eb;border-radius:4px;"/>
        <div style="font-size:10px;color:#6b7280;margin-top:4px;">Scan to Pay</div>
      </td>
    </tr></table>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:16px;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #d1d5db;border-radius:4px;">

  <!-- HEADER -->
  <table style="width:100%;border-bottom:2px solid #8B7536;"><tr>
    <td style="padding:16px 18px;width:100px;vertical-align:middle;">
      <img src="cid:company-logo" alt="Logo" style="width:76px;height:76px;object-fit:contain;display:block;"/>
    </td>
    <td style="padding:14px 18px;text-align:right;vertical-align:top;">
      <h2 style="margin:0 0 3px;font-size:21px;color:#1f2937;">${co.name}</h2>
      ${co.address ? `<div style="font-size:11px;color:#555;">${co.address}</div>` : ''}
      ${co.city    ? `<div style="font-size:11px;color:#555;">${co.city}</div>` : ''}
      ${co.gstin   ? `<div style="font-size:11px;color:#555;">GSTIN ${co.gstin}</div>` : ''}
      ${co.phone   ? `<div style="font-size:11px;color:#555;">${co.phone}</div>` : ''}
      ${co.email   ? `<div style="font-size:11px;color:#555;">${co.email}</div>` : ''}
    </td>
  </tr></table>

  <!-- TITLE -->
  <div style="text-align:center;padding:9px;border-bottom:1px solid #e5e7eb;letter-spacing:3px;font-size:13px;font-weight:700;color:#374151;">QUOTATION / PROFORMA INVOICE</div>

  <!-- BILL TO / SHIP TO / PI DETAILS -->
  <table style="width:100%;border-bottom:1px solid #e5e7eb;"><tr>
    <td style="width:34%;padding:12px 14px;vertical-align:top;">
      <div style="color:#8B7536;font-size:10px;font-weight:700;margin-bottom:4px;">BILL TO</div>
      <div style="font-size:13px;font-weight:700;color:#111;">${d.billingName || d.customerName}</div>
      ${d.companyName ? `<div style="font-size:11px;color:#555;">${d.companyName}</div>` : ''}
      ${d.location    ? `<div style="font-size:11px;color:#555;">${d.location.replace(/,\s*/g, '<br/>')}</div>` : ''}
      ${d.customerGstin ? `<div style="font-size:11px;color:#555;">GSTIN: ${d.customerGstin}</div>` : ''}
      ${d.customerPhone ? `<div style="font-size:11px;color:#555;">Phone ${d.customerPhone}</div>` : ''}
    </td>
    ${shipCell}
    <td style="width:33%;padding:12px 14px;vertical-align:top;border-left:1px solid #e5e7eb;">
      <table><tbody>
        <tr><td style="padding:2px 0;font-size:11px;color:#6b7280;white-space:nowrap;">PI / Quotation No</td><td style="padding:2px 0 2px 10px;font-size:11px;font-weight:700;">${d.piNumber}</td></tr>
        <tr><td style="padding:2px 0;font-size:11px;color:#6b7280;">Date</td><td style="padding:2px 0 2px 10px;font-size:11px;">${fmtDate(nowIST())}</td></tr>
        ${valRow}${termsRow}
      </tbody></table>
    </td>
  </tr></table>

  <!-- PRODUCTS TABLE -->
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:#f3f4f6;border-bottom:2px solid #d1d5db;">
      <th style="padding:7px 5px;font-size:11px;text-align:center;width:28px;">S.<br/>No</th>
      <th style="padding:7px 5px;font-size:11px;text-align:left;">Item</th>
      <th style="padding:7px 5px;font-size:11px;text-align:left;">Description</th>
      <th style="padding:7px 5px;font-size:11px;text-align:center;width:65px;">HSN/<br/>SAC</th>
      <th style="padding:7px 5px;font-size:11px;text-align:center;">Qty</th>
      <th style="padding:7px 5px;font-size:11px;text-align:right;">Rate (excl. GST)</th>
      <th style="padding:7px 5px;font-size:11px;text-align:right;">Amt (excl. GST)</th>
      <th style="padding:7px 5px;font-size:11px;text-align:right;">Amt (incl. GST)</th>
    </tr></thead>
    <tbody>${productRows}${extraRows}${notesRow}</tbody>
  </table>

  <!-- TOTALS -->
  <table style="width:100%;border-collapse:collapse;border-top:2px solid #d1d5db;">
    <tr><td colspan="7" style="padding:5px 8px;font-size:12px;color:#555;text-align:right;">Sub Total (excl. GST)</td><td style="padding:5px 8px;font-size:12px;text-align:right;width:105px;">${fmt(subTotalExcl)}</td></tr>
    ${discRow}
    <tr><td colspan="7" style="padding:4px 8px;font-size:11px;color:#555;text-align:right;">Total GST (18%)</td><td style="padding:4px 8px;font-size:11px;text-align:right;">${fmt(totalGst)}</td></tr>
    <tr style="background:#f9fafb;border-top:2px solid #374151;">
      <td colspan="7" style="padding:8px;font-size:13px;font-weight:700;text-align:right;">Grand Total (incl. 18% GST)</td>
      <td style="padding:8px;font-size:13px;font-weight:700;text-align:right;">${fmt(d.grandTotal)}</td>
    </tr>
  </table>

  <!-- TOTAL IN WORDS -->
  <div style="padding:8px 14px;border-top:1px solid #e5e7eb;font-size:11px;">
    <strong>Total In Words:</strong>&nbsp;<em>${numberToWords(d.grandTotal)}</em>
  </div>

  <!-- FREIGHT NOTE (only when neither is included) -->
  ${(freightAmt === 0 && installationAmt === 0) ? `
  <div style="padding:5px 14px 10px;font-size:11px;color:#6b7280;font-style:italic;border-bottom:1px solid #e5e7eb;">
    * Freight &amp; Installation charges are extra and will be quoted separately based on location.
  </div>` : ''}

  <!-- BANK DETAILS -->
  ${bankHtml}

  <!-- FOOTER -->
  <div style="background:#1f2937;padding:11px 18px;text-align:center;border-radius:0 0 4px 4px;">
    <p style="margin:0;color:#9ca3af;font-size:10px;">System-generated quotation from ${co.name}. For queries, reply to this email.</p>
    <p style="margin:3px 0 0;color:#6b7280;font-size:10px;">© ${new Date().getFullYear()} ${co.name}. All rights reserved.</p>
  </div>

</div></body></html>`;
}

/* ══════════════════════════════════════════════════════
   DISPATCH INVOICE EMAIL
   ══════════════════════════════════════════════════════ */
export interface DispatchInvoiceEmailData {
  to: string;
  customerName: string;
  billingName?: string;
  companyName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerGstin?: string;
  billAddress?: string;
  shipAddress?: string;
  orderNumber: string;
  piNumber?: string;
  leadNumber?: string;
  dispatchDate: string;
  transporter: string;
  lrNumber?: string;
  dispatchNotes?: string;
  productInterest: string;
  baseAmount: number;
  discount: number;
  freightCharges: number;
  installationCharges: number;
  paymentType?: string;
  amountPaid?: number;
  paymentConfirmed?: boolean;
}

function buildDispatchInvoiceHtml(d: DispatchInvoiceEmailData): string {
  const co = {
    name:    process.env.COMPANY_NAME    || 'Lyra Enterprises',
    address: process.env.COMPANY_ADDRESS || '10/21, Vasuki Street, Ambattur, Chennai – 600053',
    city:    process.env.COMPANY_CITY    || '',
    gstin:   process.env.COMPANY_GSTIN   || '33DMYPR1025P1ZB',
    phone:   process.env.COMPANY_PHONE   || '8122378860',
    email:   process.env.COMPANY_EMAIL   || process.env.SMTP_USER || '',
  };

  const items        = parseItems(d.productInterest);
  const totalQty     = items.reduce((s, i) => s + i.qty, 0) || 1;
  const baseAmt      = d.baseAmount;
  const disc         = d.discount;
  const freight      = d.freightCharges;
  const install      = d.installationCharges;
  const afterDisc    = baseAmt - disc;
  const unitPrice    = Math.round(baseAmt / totalQty);
  const subTotalExcl = baseAmt + (freight > 0 ? freight : 0) + (install > 0 ? install : 0);
  const totalGst     = Math.round((afterDisc + (freight > 0 ? freight : 0) + (install > 0 ? install : 0)) * 0.18);
  const grandTotal   = afterDisc + (freight > 0 ? freight : 0) + (install > 0 ? install : 0) + totalGst;

  const amtPaid  = d.paymentType === 'partial' ? (d.amountPaid || 0) : (d.paymentConfirmed ? grandTotal : 0);
  const dueOnDlv = Math.max(0, grandTotal - amtPaid);

  let sno = 0;
  const productRows = items.map(item => {
    sno++;
    const rate    = unitPrice;
    const amt     = rate * item.qty;
    const inclGst = Math.round(amt * 1.18);
    return `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:7px 5px;text-align:center;font-size:12px;">${sno}</td>
      <td style="padding:7px 5px;font-size:12px;font-weight:600;">${item.name}</td>
      <td style="padding:7px 5px;font-size:11px;color:#64748b;">${item.shortName}</td>
      <td style="padding:7px 5px;text-align:center;font-size:12px;">${item.qty}.00<br/><span style="font-size:10px;color:#94a3b8;">nos</span></td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmtInt(rate)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmt(amt)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:700;">${fmt(inclGst)}</td>
    </tr>`;
  }).join('');

  let extraRows = '';
  if (freight > 0) {
    sno++;
    extraRows += `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:7px 5px;text-align:center;font-size:12px;">${sno}</td>
      <td style="padding:7px 5px;font-size:12px;font-weight:600;">Freight Charges</td>
      <td style="padding:7px 5px;font-size:11px;color:#64748b;">Logistics &amp; Transportation</td>
      <td style="padding:7px 5px;text-align:center;font-size:12px;">1.00<br/><span style="font-size:10px;color:#94a3b8;">lump</span></td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmtInt(freight)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmt(freight)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:700;">${fmt(Math.round(freight * 1.18))}</td>
    </tr>`;
  }
  if (install > 0) {
    sno++;
    extraRows += `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:7px 5px;text-align:center;font-size:12px;">${sno}</td>
      <td style="padding:7px 5px;font-size:12px;font-weight:600;">Installation Charges</td>
      <td style="padding:7px 5px;font-size:11px;color:#64748b;">Setup &amp; Commissioning</td>
      <td style="padding:7px 5px;text-align:center;font-size:12px;">1.00<br/><span style="font-size:10px;color:#94a3b8;">lump</span></td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmtInt(install)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmt(install)}</td>
      <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:700;">${fmt(Math.round(install * 1.18))}</td>
    </tr>`;
  }

  const wStart = new Date(d.dispatchDate);
  const wEnd   = new Date(wStart); wEnd.setFullYear(wEnd.getFullYear() + 1);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:16px;background:#f1f5f9;font-family:Arial,sans-serif;">
<div style="max-width:720px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">

  <!-- HEADER BAND -->
  <table style="width:100%;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 60%,#1d4ed8 100%);"><tr>
    <td style="padding:20px 22px;vertical-align:middle;width:90px;">
      <img src="cid:company-logo" alt="Logo" style="width:72px;height:72px;object-fit:contain;display:block;filter:brightness(0) invert(1);border-radius:6px;"/>
    </td>
    <td style="padding:18px 22px;vertical-align:top;">
      <div style="font-size:21px;font-weight:900;color:#fff;letter-spacing:.5px;">${co.name}</div>
      <div style="font-size:11px;color:#93c5fd;margin-top:3px;line-height:1.8;">
        ${co.address}${co.city ? ' · ' + co.city : ''}<br/>
        Ph: ${co.phone} · ${co.email}<br/>
        GSTIN: ${co.gstin}
      </div>
    </td>
    <td style="padding:18px 22px;text-align:right;vertical-align:top;">
      <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;">Tax Invoice</div>
      <div style="font-size:11px;color:#bfdbfe;margin-top:6px;line-height:2.0;">
        Order # <strong style="color:#fff;">${d.orderNumber}</strong><br/>
        ${d.piNumber ? `PI # <strong style="color:#fff;">${d.piNumber}</strong><br/>` : ''}
        ${d.leadNumber ? `Lead # <strong style="color:#fff;">${d.leadNumber}</strong><br/>` : ''}
        Date <strong style="color:#fff;">${fmtDate(d.dispatchDate)}</strong>
      </div>
    </td>
  </tr></table>

  <!-- BILL TO / SHIP TO -->
  <table style="width:100%;border-bottom:1px solid #e2e8f0;"><tr>
    <td style="width:50%;padding:14px 18px;vertical-align:top;border-right:1px solid #e2e8f0;">
      <div style="font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#1d4ed8;margin-bottom:6px;">Bill To</div>
      <div style="font-size:14px;font-weight:700;color:#0f172a;">${d.billingName || d.customerName}</div>
      ${d.companyName ? `<div style="font-size:12px;font-weight:600;color:#374151;">${d.companyName}</div>` : ''}
      ${d.customerGstin ? `<div style="display:inline-block;margin-top:4px;padding:2px 8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;font-size:10.5px;font-weight:600;color:#0369a1;">GSTIN: ${d.customerGstin}</div>` : ''}
      ${d.billAddress ? `<div style="font-size:11.5px;color:#475569;margin-top:5px;line-height:1.7;">${d.billAddress.replace(/\n/g, '<br/>')}</div>` : ''}
      ${d.customerPhone ? `<div style="font-size:11.5px;color:#475569;margin-top:4px;">📞 ${d.customerPhone}</div>` : ''}
      ${d.customerEmail ? `<div style="font-size:11.5px;color:#475569;">✉ ${d.customerEmail}</div>` : ''}
    </td>
    <td style="width:50%;padding:14px 18px;vertical-align:top;">
      <div style="font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#0f172a;margin-bottom:6px;">Ship To</div>
      <div style="font-size:14px;font-weight:700;color:#0f172a;">${d.customerName}</div>
      ${d.companyName ? `<div style="font-size:12px;font-weight:600;color:#374151;">${d.companyName}</div>` : ''}
      ${d.shipAddress ? `<div style="font-size:11.5px;color:#475569;margin-top:5px;line-height:1.7;">${d.shipAddress.replace(/\n/g, '<br/>')}</div>` : ''}
      ${d.customerPhone ? `<div style="font-size:11.5px;color:#475569;margin-top:4px;font-weight:600;">📞 ${d.customerPhone}</div>` : ''}
    </td>
  </tr></table>

  <!-- ITEMS TABLE -->
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:#0f172a;">
      <th style="padding:8px 5px;font-size:10px;color:#e2e8f0;text-align:center;width:28px;">#</th>
      <th style="padding:8px 5px;font-size:10px;color:#e2e8f0;text-align:left;">Item</th>
      <th style="padding:8px 5px;font-size:10px;color:#e2e8f0;text-align:left;">Description</th>
      <th style="padding:8px 5px;font-size:10px;color:#e2e8f0;text-align:center;width:65px;">HSN/<br/>SAC</th>
      <th style="padding:8px 5px;font-size:10px;color:#e2e8f0;text-align:center;">Qty</th>
      <th style="padding:8px 5px;font-size:10px;color:#e2e8f0;text-align:right;">Rate (excl. GST)</th>
      <th style="padding:8px 5px;font-size:10px;color:#e2e8f0;text-align:right;">Amt (excl. GST)</th>
      <th style="padding:8px 5px;font-size:10px;color:#e2e8f0;text-align:right;">Amt (incl. GST)</th>
    </tr></thead>
    <tbody>${productRows}${extraRows}</tbody>
  </table>

  <!-- TOTALS -->
  <table style="width:100%;border-collapse:collapse;border-top:2px solid #1e293b;">
    <tr><td colspan="7" style="padding:5px 10px;font-size:12px;color:#64748b;text-align:right;">Sub Total (excl. GST)</td><td style="padding:5px 10px;font-size:12px;text-align:right;width:115px;">₹ ${fmt(subTotalExcl)}</td></tr>
    ${disc > 0 ? `<tr><td colspan="7" style="padding:4px 10px;font-size:12px;color:#dc2626;text-align:right;">Less: Discount</td><td style="padding:4px 10px;font-size:12px;text-align:right;color:#dc2626;">− ₹ ${fmt(disc)}</td></tr>` : ''}
    <tr><td colspan="7" style="padding:4px 10px;font-size:11px;color:#64748b;text-align:right;">Total GST (18%)</td><td style="padding:4px 10px;font-size:11px;text-align:right;">₹ ${fmt(totalGst)}</td></tr>
    <tr style="background:linear-gradient(90deg,#0f172a,#1e3a8a);">
      <td colspan="7" style="padding:10px;font-size:13px;font-weight:900;text-align:right;color:#bfdbfe;">Grand Total (incl. 18% GST)</td>
      <td style="padding:10px;font-size:14px;font-weight:900;text-align:right;color:#fff;">₹ ${fmt(grandTotal)}</td>
    </tr>
  </table>
  <div style="padding:6px 10px;text-align:right;font-size:10.5px;font-style:italic;color:#64748b;border-bottom:1px solid #e2e8f0;">${numberToWords(grandTotal)}</div>

  <!-- PAYMENT SUMMARY -->
  <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #e2e8f0;">
    <tr><td colspan="2" style="padding:8px 14px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff;">💳 Payment Summary</td></tr>
    <tr style="background:#eff6ff;"><td style="padding:6px 14px;font-size:12.5px;color:#475569;font-weight:600;width:200px;">Invoice Amount</td><td style="padding:6px 14px;font-size:12.5px;text-align:right;font-weight:700;">₹ ${fmt(grandTotal)}</td></tr>
    ${amtPaid > 0 ? `<tr style="background:#f0fdf4;"><td style="padding:6px 14px;font-size:12.5px;color:#475569;font-weight:600;">Advance Received</td><td style="padding:6px 14px;font-size:12.5px;text-align:right;font-weight:700;color:#16a34a;">₹ ${fmt(amtPaid)}</td></tr>` : ''}
    <tr style="background:${dueOnDlv > 0 ? '#fff5f5' : '#f0fdf4'};"><td style="padding:8px 14px;font-size:14px;font-weight:800;color:${dueOnDlv > 0 ? '#dc2626' : '#16a34a'};">${dueOnDlv > 0 ? 'Amount Due on Delivery' : '✅ Fully Paid'}</td><td style="padding:8px 14px;font-size:14px;font-weight:900;text-align:right;color:${dueOnDlv > 0 ? '#dc2626' : '#16a34a'};">${dueOnDlv > 0 ? `₹ ${fmt(dueOnDlv)}` : '₹ 0'}</td></tr>
  </table>

  <!-- DISPATCH DETAILS -->
  <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #e2e8f0;">
    <tr><td colspan="2" style="padding:8px 14px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;background:linear-gradient(90deg,#0f172a,#334155);color:#fff;">📦 Dispatch Details</td></tr>
    <tr><td style="padding:5px 14px;font-size:11.5px;color:#64748b;font-weight:600;width:160px;">Transporter</td><td style="padding:5px 14px;font-size:11.5px;color:#1e293b;">${d.transporter}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:5px 14px;font-size:11.5px;color:#64748b;font-weight:600;">LR / Docket #</td><td style="padding:5px 14px;font-size:11.5px;color:#1e293b;font-weight:700;">${d.lrNumber || '—'}</td></tr>
    <tr><td style="padding:5px 14px;font-size:11.5px;color:#64748b;font-weight:600;">Dispatch Date</td><td style="padding:5px 14px;font-size:11.5px;color:#1e293b;">${fmtDate(d.dispatchDate)}</td></tr>
    ${d.dispatchNotes ? `<tr style="background:#f8fafc;"><td style="padding:5px 14px;font-size:11.5px;color:#64748b;font-weight:600;">Remarks</td><td style="padding:5px 14px;font-size:11.5px;color:#1e293b;">${d.dispatchNotes}</td></tr>` : ''}
  </table>

  <!-- WARRANTY -->
  <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #e2e8f0;">
    <tr><td colspan="2" style="padding:8px 14px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;background:linear-gradient(90deg,#14532d,#16a34a);color:#fff;">🛡️ Warranty – 1 Year Limited Warranty</td></tr>
    <tr><td style="padding:5px 14px;font-size:11.5px;color:#15803d;font-weight:600;width:160px;">Warranty Period</td><td style="padding:5px 14px;font-size:11.5px;"><strong>1 Year</strong> from date of dispatch</td></tr>
    <tr style="background:#f0fdf4;"><td style="padding:5px 14px;font-size:11.5px;color:#15803d;font-weight:600;">Warranty Start</td><td style="padding:5px 14px;font-size:11.5px;">${fmtDate(wStart.toISOString())}</td></tr>
    <tr><td style="padding:5px 14px;font-size:11.5px;color:#15803d;font-weight:600;">Warranty Expiry</td><td style="padding:5px 14px;font-size:11.5px;font-weight:700;">${fmtDate(wEnd.toISOString())}</td></tr>
    <tr style="background:#f0fdf4;"><td colspan="2" style="padding:5px 14px;font-size:10.5px;color:#166534;font-style:italic;">To claim warranty, quote Order # <strong>${d.orderNumber}</strong>${d.piNumber ? ` and PI # <strong>${d.piNumber}</strong>` : ''}. Contact: ${co.phone} · ${co.email}</td></tr>
  </table>

  <!-- FOOTER -->
  <div style="background:#0f172a;padding:12px 18px;text-align:center;">
    <p style="margin:0;color:#94a3b8;font-size:10px;">System-generated tax invoice from ${co.name}. For queries, contact us at ${co.email}</p>
    <p style="margin:3px 0 0;color:#64748b;font-size:10px;">© ${new Date().getFullYear()} ${co.name} · GSTIN: ${co.gstin}</p>
  </div>

</div></body></html>`;
}

export async function sendDispatchInvoiceEmail(data: DispatchInvoiceEmailData): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('Email not configured. Set SMTP_USER and SMTP_PASS in .env');
  }
  const t = createTransporter();
  await t.verify();

  const logoPath   = path.resolve(__dirname, '../../data/logo.png');
  const logoExists = fs.existsSync(logoPath);
  const attachments: { filename: string; path: string; cid: string }[] = [];
  if (logoExists) attachments.push({ filename: 'logo.png', path: logoPath, cid: 'company-logo' });

  const coName = process.env.COMPANY_NAME || 'Lyra Enterprises';
  await t.sendMail({
    from: `"${coName}" <${process.env.SMTP_USER}>`,
    to: data.to,
    bcc: process.env.SMTP_USER,
    subject: `Tax Invoice ${data.orderNumber}${data.piNumber ? ' / ' + data.piNumber : ''} – ${coName}`,
    html: buildDispatchInvoiceHtml(data),
    attachments,
  });
}

export async function sendQuotationEmail(data: QuotationEmailData): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('Email not configured. Set SMTP_USER and SMTP_PASS in .env');
  }
  const t = createTransporter();
  await t.verify();

  const qrFilePath = process.env.BANK_QR_FILE
    ? path.resolve(__dirname, '../../', process.env.BANK_QR_FILE)
    : '';
  const qrExists = qrFilePath && fs.existsSync(qrFilePath);

  const logoPath = path.resolve(__dirname, '../../data/logo.png');
  const logoExists = fs.existsSync(logoPath);

  const attachments: { filename: string; path: string; cid: string }[] = [];
  if (logoExists) attachments.push({ filename: 'logo.png', path: logoPath, cid: 'company-logo' });
  if (qrExists)   attachments.push({ filename: 'payment-qr.png', path: qrFilePath, cid: 'payment-qr' });

  await t.sendMail({
    from: `"${process.env.COMPANY_NAME || 'Lyra Enterprises'}" <${process.env.SMTP_USER}>`,
    to: data.to,
    bcc: process.env.SMTP_USER,
    subject: `Quotation ${data.piNumber} – ${process.env.COMPANY_NAME || 'Lyra Enterprises'}`,
    html: buildQuotationHtml(data),
    attachments,
  });
}
