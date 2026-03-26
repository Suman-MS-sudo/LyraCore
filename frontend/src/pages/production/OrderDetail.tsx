import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { ProductionOrder } from '../../types';
import { OrderStatusBadge, PriorityBadge } from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import { formatDate, formatDateTime, formatCurrency, parseIST, todayIST } from '../../utils/helpers';
import { useAuth } from '../../contexts/AuthContext';

const QC_CHECKS_VENDING = [
  'Power & Electrical Stability Test',
  'Full Vending Cycle Test',
  'Payment & Control Logic Test',
  'Door, Lock & Access Control Test',
  'Sensor & Error Handling Test',
];

const QC_CHECKS_INCINERATOR = [
  'Power & Safety Isolation Test',
  'Heating Element & Temperature Rise Test',
  'Temperature Control & Cut-Off Test',
  'Chamber Door & Safety Interlock Test',
  'Ash Handling & Exhaust Test',
];

function parseOrderProducts(productInterest: string = ''): { name: string; sku: string; qty: number }[] {
  const results: { name: string; sku: string; qty: number }[] = [];
  const pattern = /(\d+)\s*x\s+([^,(]+?)\s*\(([^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(productInterest)) !== null) {
    results.push({ qty: parseInt(m[1], 10), name: m[2].trim(), sku: m[3].trim() });
  }
  if (results.length === 0 && productInterest.trim()) {
    results.push({ qty: 1, name: productInterest.trim(), sku: '' });
  }
  return results;
}

function getProductType(name: string, sku: string): 'vending' | 'incinerator' {
  const s = `${name} ${sku}`.toLowerCase();
  if (/snvm|vending/i.test(s)) return 'vending';
  if (/snd|incinerator|dispenser/i.test(s)) return 'incinerator';
  return 'vending';
}

function genSerial(sku: string, unitIdx: number, orderNumber = ''): string {
  const parts = sku.split('/').filter(p => p && !/^lyra$/i.test(p));
  const prefix = parts.length ? parts.join('-').toUpperCase() : sku.replace(/[\/\\]/g, '-').toUpperCase();
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  // derive a short order-specific code from the last alphanumeric segment of the order number
  const orderCode = orderNumber
    ? orderNumber.replace(/[^a-zA-Z0-9]/g, '-').split('-').filter(Boolean).pop()?.toUpperCase() || ''
    : '';
  const seq = String(unitIdx + 1).padStart(2, '0');
  return orderCode ? `${prefix}-${yymm}-${orderCode}-${seq}` : `${prefix}-${yymm}-${seq}`;
}

function getQCChecks(nameOrInterest = '', sku = ''): { checks: string[]; label: string } {
  const type = getProductType(nameOrInterest, sku);
  return type === 'incinerator'
    ? { checks: QC_CHECKS_INCINERATOR, label: '🔥 Incinerator QC' }
    : { checks: QC_CHECKS_VENDING,     label: '🍮 Vending Machine QC' };
}

// ─── Packing Checklists ───────────────────────────────────────────────────────

const PACKING_VENDING = [
  'Spring with 2 supports',
  'Coin box',
  'Keys',
  'Screw pack',
  'Sample napkins (25 nos)',
  'Warranty card',
  'User manual',
];

const PACKING_INCINERATOR = [
  'Wall mounting clamps (2 nos)',
  'Ash tray',
  'Screw pack',
  'Warranty card',
  'User manual',
];

function getPackingChecks(name: string, sku = ''): { checks: string[]; label: string } {
  const type = getProductType(name, sku);
  return type === 'incinerator'
    ? { checks: PACKING_INCINERATOR, label: '🔥 Incinerator Packing' }
    : { checks: PACKING_VENDING,     label: '🍮 Vending Machine Packing' };
}

// ─── Production Labels: 2× address + 4× serial per unit ─────────────────────
function printProductionLabels(o: any, serials: string[]) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;

  const addr = o.delivery_address || o.address || '';
  const phone = o.customer_phone || '';
  const company = o.company || o.customer_name;
  const orderNo = o.order_number;
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Parse product units
  const products = parseOrderProducts(o.product_interest || '');
  const units: { name: string; sku: string; serial: string }[] = [];
  let si = 0;
  for (const p of products) {
    for (let i = 0; i < p.qty; i++) {
      units.push({ name: p.name, sku: p.sku, serial: serials[si] || '' });
      si++;
    }
  }

  const addrHtml = addr.replace(/\n/g, '<br>');

  // 4 address labels per unit
  const addrBlock = (unit: { name: string; sku: string; serial: string }, unitIdx: number, copyIdx: number) => `
    <div class="addr-label">
      <div class="from-line">FROM: Lyra Enterprises, 10/21 Vasuki Street, Ambattur, Chennai - 600053 | Ph: 8122378860</div>
      <div class="to-tag">TO: ${copyIdx + 1}/4 &nbsp;·&nbsp; Unit ${unitIdx + 1}: ${unit.name}</div>
      <div class="cname">${company}</div>
      <div class="caddr">${addrHtml || '—'}</div>
      ${phone ? `<div class="cphone">📞 ${phone}</div>` : ''}
      <div class="ref-line">Order: <strong>${orderNo}</strong> &nbsp;|&nbsp; SN: <strong>${unit.serial || '—'}</strong> &nbsp;|&nbsp; ${today}</div>
    </div>`;

  // 6 serial labels per unit
  const serialBlock = (unit: { name: string; sku: string; serial: string }, unitIdx: number) =>
    Array.from({ length: 6 }, (_, ci) => `
    <div class="serial-label">
      <div class="brand">LYRA ENTERPRISES</div>
      <div class="prod-name">${unit.name}</div>
      ${unit.sku ? `<div class="sku">SKU: ${unit.sku}</div>` : ''}
      <div class="serial-row">S/N: <span class="serial-val">${unit.serial || '_______________'}</span></div>
      <div class="meta-row">Unit ${unitIdx + 1} &nbsp;·&nbsp; Copy ${ci + 1}/6</div>
      <div class="meta-row">Order: ${orderNo} &nbsp;·&nbsp; ${today}</div>
    </div>`).join('');

  win.document.write(`<!DOCTYPE html><html><head><title>Production Labels — ${orderNo}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
  h2 { font-size: 13px; color: #555; margin-bottom: 10px; }
  .section-title { font-size: 11px; font-weight: bold; color: #888; text-transform: uppercase;
    letter-spacing: 1px; margin: 16px 0 8px; border-bottom: 1px dashed #ccc; padding-bottom: 4px; }
  .label-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .label-grid { display: flex; flex-wrap: wrap; gap: 10px; }

  /* ── Address Label: ~148mm × 90mm ── */
  .addr-label {
    width: 380px; border: 2px solid #222; padding: 14px 16px; background: #fff;
    page-break-inside: avoid;
  }
  .from-line { font-size: 8.5px; color: #666; border-bottom: 1px dashed #bbb; padding-bottom: 6px; margin-bottom: 8px; }
  .to-tag { font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #444; margin-bottom: 4px; }
  .cname { font-size: 16px; font-weight: bold; line-height: 1.3; }
  .caddr { font-size: 12px; color: #333; margin-top: 5px; line-height: 1.6; }
  .cphone { font-size: 12px; font-weight: 600; margin-top: 5px; }
  .ref-line { font-size: 9px; color: #555; margin-top: 8px; border-top: 1px dashed #bbb; padding-top: 5px; }

  /* ── Serial Label: ~90mm × 55mm ── */
  .serial-label {
    width: 220px; border: 1.5px solid #444; padding: 10px 12px; background: #fff;
    page-break-inside: avoid;
  }
  .brand { font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px;
    color: #888; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 5px; }
  .prod-name { font-size: 12px; font-weight: bold; line-height: 1.3; }
  .sku { font-size: 9px; color: #666; margin-top: 2px; }
  .serial-row { font-size: 11px; margin-top: 6px; }
  .serial-val { font-family: monospace; font-size: 12px; font-weight: bold; color: #1d4ed8; letter-spacing: 0.5px; }
  .meta-row { font-size: 8px; color: #888; margin-top: 3px; }

  /* ── Print ── */
  @media print {
    body { background: white; padding: 8px; }
    .no-print { display: none; }
    .section-title { color: #444; }
    .machine-page { break-after: page; page-break-after: always; }
    .machine-page:last-child { break-after: avoid; page-break-after: avoid; }
  }
</style>
</head><body>

<div class="no-print" style="margin-bottom:14px;display:flex;gap:10px;align-items:center;">
  <button onclick="window.print()" style="padding:7px 20px;font-size:13px;cursor:pointer;background:#1d4ed8;color:white;border:none;border-radius:6px;font-weight:bold;">🖨️ Print All Labels</button>
  <span style="font-size:12px;color:#555;">Order: <strong>${orderNo}</strong> — ${units.length} unit(s) — ${units.length * 10} labels total (4 address + 6 serial per machine)</span>
</div>

${units.map((u, ui) => `
  <div class="machine-page">
    <div class="section-title">📦 Machine ${ui + 1}: ${u.name} ${u.serial ? `· SN: ${u.serial}` : ''}</div>
    <div class="label-grid" style="margin-bottom:8px;">
      <div>
        <div style="font-size:10px;color:#888;margin-bottom:4px;">📮 Address Labels (4 copies)</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${Array.from({ length: 4 }, (_, ci) => addrBlock(u, ui, ci)).join('')}
        </div>
      </div>
      <div style="margin-top:10px;">
        <div style="font-size:10px;color:#888;margin-bottom:4px;">🔖 Serial Labels (6 copies)</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${serialBlock(u, ui)}
        </div>
      </div>
    </div>
  </div>
`).join('')}

</body></html>`);
  win.document.close();
  win.focus();
}

function printShippingLabel(addr: string, name: string, orderNo: string, phone?: string) {
  const win = window.open('', '_blank', 'width=440,height=380');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>Shipping Label</title>
    <style>body{font-family:Arial,sans-serif;padding:30px;margin:0}
    .label{border:3px solid #000;padding:24px;width:360px;box-sizing:border-box}
    .from{font-size:10px;color:#555;margin-bottom:14px;border-bottom:1px dashed #ccc;padding-bottom:8px}
    .to-tag{font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
    .cname{font-size:17px;font-weight:bold}
    .addr{font-size:13px;white-space:pre-wrap;margin-top:6px;line-height:1.6}
    .phone{font-size:13px;margin-top:6px;font-weight:600}
    .ref{font-size:10px;color:#555;margin-top:14px;border-top:1px dashed #ccc;padding-top:6px}
    @media print{button{display:none}}</style>
  </head><body>
    <div class="label">
      <div class="from">FROM: Lyra Enterprises, 10/21 Vasuki Street, Ambattur, Chennai 600053 | Ph: 8122378860</div>
      <div class="to-tag">TO:</div>
      <div class="cname">${name}</div>
      <div class="addr">${addr}</div>
      ${phone ? `<div class="phone">📞 ${phone}</div>` : ''}
      <div class="ref">Order Ref: ${orderNo}</div>
    </div>
    <br><button onclick="window.print()" style="padding:6px 16px;font-size:13px;cursor:pointer">🖸️ Print Label</button>
  </body></html>`);
  win.document.close(); win.focus();
}

function printDispatchInvoice(o: any, d: any, catalog: { name: string; model_code: string; base_price: number; hsn_sac_code: string }[]) {
  const win = window.open('', '_blank', 'width=950,height=900');
  if (!win) return;
  const fmt = (s: string) => { try { return parseIST(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); } catch { return s; } };
  const fmtN = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtI = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // strip bare phone-number lines from address
  const cleanAddr = (a: string) =>
    a.split('\n').filter(l => !/^\s*[\d\s\-\+\(\)]{7,15}\s*$/.test(l.trim())).join('\n').trim();

  // parse product items from product_interest string
  const parseItems = (pi: string) => {
    const items: { qty: number; fullName: string; shortName: string; modelCode: string }[] = [];
    const re = /(\d+)\s*x\s+([^,(]+?)(?:\s*\(([^)]+)\))?(?:,|$)/gi;
    let m;
    while ((m = re.exec(pi)) !== null) {
      const shortName = m[2].trim();
      const modelCode = m[3] ? m[3].trim() : '';
      items.push({ qty: Number(m[1]), fullName: modelCode ? `${shortName} (${modelCode})` : shortName, shortName, modelCode });
    }
    if (!items.length) items.push({ qty: 1, fullName: pi, shortName: pi, modelCode: '' });
    return items;
  };
  const parsedItems = parseItems(o.product_interest || '');

  // Build serial map: prefer order_serials (allocated), fall back to testing checklist
  const serialMap: Record<string, string[]> = {};
  if (Array.isArray(o.allocatedSerials) && o.allocatedSerials.length > 0) {
    (o.allocatedSerials as any[]).forEach((s: any) => {
      const baseName = String(s.unit_label || s.sku || '').replace(/\s*#\d+$/, '').trim();
      if (!serialMap[baseName]) serialMap[baseName] = [];
      serialMap[baseName].push(s.serial_number);
    });
  } else if (o.testing?.checklist_data) {
    try {
      let cd: any = JSON.parse(o.testing.checklist_data);
      if (typeof cd === 'string') cd = JSON.parse(cd);
      if (cd?.version === 2 && Array.isArray(cd.units)) {
        (cd.units as any[]).forEach((u: any) => {
          if (!u.serial) return;
          const baseName = String(u.label || '').replace(/\s*#\d+$/, '').trim();
          if (!serialMap[baseName]) serialMap[baseName] = [];
          serialMap[baseName].push(u.serial);
        });
      }
    } catch {}
  }

  // amounts from quotation fields
  const baseAmt   = Number(o.amount || 0);
  const disc      = Number(o.discount || 0);
  const freight   = Number(o.freight_charges || 0);
  const install   = Number(o.installation_charges || 0);
  const fCgst     = Math.round(freight * 0.09);
  const fSgst     = Math.round(freight * 0.09);
  const iCgst     = Math.round(install * 0.09);
  const iSgst     = Math.round(install * 0.09);

  // per-item rates — look up from product catalog by model_code
  const totalQty = parsedItems.reduce((s, i) => s + i.qty, 0) || 1;
  const fallbackUnitPrice = Math.round(baseAmt / totalQty);
  const getItemRate = (modelCode: string): number => {
    if (modelCode && catalog.length > 0) {
      const hit = catalog.find(p => p.model_code?.toLowerCase() === modelCode.toLowerCase());
      if (hit) return hit.base_price;
    }
    return fallbackUnitPrice;
  };
  const getItemHsn = (item: { shortName: string; modelCode: string }): string => {
    if (catalog.length > 0) {
      if (item.modelCode) {
        const hit = catalog.find(p => p.model_code?.toLowerCase() === item.modelCode.toLowerCase());
        if (hit?.hsn_sac_code) return hit.hsn_sac_code;
      }
      const hit = catalog.find(p =>
        item.shortName.toLowerCase().includes(p.name.toLowerCase()) ||
        p.name.toLowerCase().includes(item.shortName.toLowerCase())
      );
      if (hit?.hsn_sac_code) return hit.hsn_sac_code;
    }
    return '841900';
  };
  const itemRates = parsedItems.map(item => getItemRate(item.modelCode));
  const computedBase = parsedItems.reduce((s, item, i) => s + itemRates[i] * item.qty, 0);
  const effectiveBase = computedBase > 0 && catalog.length > 0 ? computedBase : baseAmt;

  const afterDisc  = effectiveBase - disc;
  const cgst       = Math.round(afterDisc * 0.09);
  const sgst       = Math.round(afterDisc * 0.09);
  const subTotal   = effectiveBase + (freight > 0 ? freight : 0) + (install > 0 ? install : 0);
  const grandTotal = afterDisc + cgst + sgst
    + (freight > 0 ? freight + fCgst + fSgst : 0)
    + (install > 0 ? install + iCgst + iSgst : 0);

  // payment
  const amtPaid    = o.payment_type === 'partial' ? Number(o.amount_paid || 0) : (o.payment_confirmed ? grandTotal : 0);
  const dueOnDlv   = Math.max(0, grandTotal - amtPaid);

  // warranty dates
  const wStart = d.dispatch_date ? new Date(d.dispatch_date) : new Date();
  const wEnd   = new Date(wStart); wEnd.setFullYear(wEnd.getFullYear() + 1);

  // number to words
  const n2w = (n: number) => {
    const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    const w = (x: number): string => {
      if (!x) return '';
      if (x < 20) return ones[x];
      if (x < 100) return tens[Math.floor(x/10)] + (x%10 ? ' '+ones[x%10] : '');
      return ones[Math.floor(x/100)]+' Hundred'+(x%100 ? ' '+w(x%100) : '');
    };
    const cr=Math.floor(n/10000000),lk=Math.floor((n%10000000)/100000),th=Math.floor((n%100000)/1000),rm=n%1000;
    return 'Rupees '+[cr?w(cr)+' Crore':'',lk?w(lk)+' Lakh':'',th?w(th)+' Thousand':'',rm?w(rm):''].filter(Boolean).join(' ')+' Only';
  };

  // product rows — Amount is pre-GST so Sub Total = simple sum of row amounts
  const productRows = parsedItems.map((item, i) => {
    const rate       = itemRates[i];
    const grossAmt   = rate * item.qty;
    const inclGst    = Math.round(grossAmt * 1.18);
    const hsn        = getItemHsn(item);
    return `<tr style="border-bottom:1px solid #e5e7eb;${i%2===1?'background:#f9fafb':''}">
      <td style="padding:7px 10px;text-align:center">${i+1}</td>
      <td style="padding:7px 10px"><strong>${item.fullName}</strong></td>
      <td style="padding:7px 10px;text-align:center;color:#555">${item.shortName !== item.fullName ? item.shortName : '—'}</td>
      <td style="padding:7px 10px;text-align:center;font-size:11px;color:#666">${hsn}</td>
      <td style="padding:7px 10px;text-align:center">${item.qty}.00<br><span style="font-size:10px;color:#aaa">nos</span></td>
      <td style="padding:7px 10px;text-align:right">${fmtI(rate)}</td>
      <td style="padding:7px 10px;text-align:right">${fmtN(grossAmt)}</td>
      <td style="padding:7px 10px;text-align:right;font-weight:600">${fmtN(inclGst)}</td>
    </tr>`;
  }).join('');

  const freightRow = freight > 0 ? `<tr style="border-bottom:1px solid #e5e7eb">
    <td style="padding:7px 10px;text-align:center">${parsedItems.length+1}</td>
    <td style="padding:7px 10px"><strong>Freight Charges</strong></td>
    <td style="padding:7px 10px;color:#555">Logistics &amp; Transportation</td>
    <td style="padding:7px 10px;text-align:center;font-size:11px;color:#666">996511</td>
    <td style="padding:7px 10px;text-align:center">1.00<br><span style="font-size:10px;color:#aaa">lump</span></td>
    <td style="padding:7px 10px;text-align:right">${fmtI(freight)}</td>
    <td style="padding:7px 10px;text-align:right">${fmtN(freight)}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:600">${fmtN(freight + fCgst + fSgst)}</td>
  </tr>` : '';

  const installRow = install > 0 ? `<tr style="border-bottom:1px solid #e5e7eb">
    <td style="padding:7px 10px;text-align:center">${parsedItems.length + (freight>0?1:0) + 1}</td>
    <td style="padding:7px 10px"><strong>Installation Charges</strong></td>
    <td style="padding:7px 10px;color:#555">Setup &amp; Commissioning</td>
    <td style="padding:7px 10px;text-align:center;font-size:11px;color:#666">998721</td>
    <td style="padding:7px 10px;text-align:center">1.00<br><span style="font-size:10px;color:#aaa">lump</span></td>
    <td style="padding:7px 10px;text-align:right">${fmtI(install)}</td>
    <td style="padding:7px 10px;text-align:right">${fmtN(install)}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:600">${fmtN(install + iCgst + iSgst)}</td>
  </tr>` : '';

  const billAddr = cleanAddr(o.address || o.location || '');
  const shipAddr = cleanAddr(o.delivery_address || d.delivery_address || '');
  const logoUrl  = `${window.location.origin}/data/logo.png`;

  win.document.write(`<!DOCTYPE html><html><head><title>Dispatch Challan – ${o.order_number}</title>
  <meta charset="utf-8"/>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',Arial,sans-serif;background:#f1f5f9;color:#1e293b;font-size:12.5px;line-height:1.6}
    .page{background:#fff;max-width:900px;margin:24px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)}

    /* ── HEADER BAND ── */
    .hdr-band{background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 60%,#1d4ed8 100%);padding:28px 36px;display:flex;justify-content:space-between;align-items:center}
    .hdr-logo{display:flex;align-items:center;gap:16px}
    .hdr-logo img{height:56px;width:auto;object-fit:contain;filter:brightness(0) invert(1);border-radius:6px}
    .hdr-co-name{font-size:22px;font-weight:900;color:#fff;letter-spacing:.5px}
    .hdr-co-sub{font-size:11px;color:#93c5fd;margin-top:2px;line-height:1.7}
    .hdr-doc{text-align:right}
    .hdr-doc-title{font-size:24px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase}
    .hdr-doc-badge{display:inline-block;margin-top:5px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:2px 10px;font-size:10px;font-weight:700;color:#bfdbfe;letter-spacing:1.5px;text-transform:uppercase}
    .hdr-doc-sub{font-size:11px;color:#bfdbfe;margin-top:6px;line-height:1.9}
    .hdr-doc-sub span{font-weight:700;color:#fff}

    /* ── BODY PADDING ── */
    .body{padding:28px 36px}

    /* ── ADDRESS CARDS ── */
    .addr-row{display:flex;gap:16px;margin-bottom:24px}
    .addr-card{flex:1;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0}
    .addr-card-hdr{padding:7px 14px;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px}
    .addr-bill .addr-card-hdr{background:#eff6ff;color:#1d4ed8;border-bottom:1px solid #bfdbfe}
    .addr-ship .addr-card-hdr{background:#0f172a;color:#e2e8f0}
    .addr-card-body{padding:12px 14px;background:#fff;font-size:12px}
    .addr-card-body .name{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px}
    .addr-card-body .co{font-weight:600;color:#374151;margin-bottom:2px}
    .addr-card-body .line{color:#64748b;margin-top:1px}
    .addr-card-body .gstin{display:inline-block;margin-top:5px;padding:2px 8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;font-size:10.5px;font-weight:600;color:#0369a1}

    /* ── ITEMS TABLE ── */
    .tbl-wrap{border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:16px}
    table.items{width:100%;border-collapse:collapse;font-size:12px}
    table.items thead tr{background:linear-gradient(90deg,#0f172a,#1e3a8a)}
    table.items th{padding:9px 10px;color:#e2e8f0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px}
    table.items tbody tr{border-bottom:1px solid #f1f5f9}
    table.items tbody tr:last-child{border-bottom:none}
    table.items tbody tr:nth-child(even) td{background:#f8fafc}
    table.items td{padding:8px 10px;vertical-align:top;color:#1e293b}
    table.items td .model{font-size:10.5px;color:#94a3b8;margin-top:1px}
    table.items td .unit{font-size:10px;color:#94a3b8}
    table.items td .tax-pct{font-size:10px;color:#6366f1;font-weight:600}
    table.items td .serial{font-size:10px;color:#0369a1;font-family:monospace;margin-top:3px;font-weight:600}

    /* ── TOTALS ── */
    .totals-wrap{display:flex;justify-content:flex-end;margin-bottom:6px}
    .totals-box{border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;min-width:300px}
    .totals-box table{width:100%;border-collapse:collapse}
    .totals-box tr td{padding:7px 16px;font-size:12.5px;border-bottom:1px solid #f1f5f9}
    .totals-box tr:last-child td{border-bottom:none}
    .totals-box .lbl{color:#64748b;font-weight:500}
    .totals-box .val{text-align:right;font-weight:600;color:#1e293b}
    .totals-box .disc .lbl{color:#dc2626}
    .totals-box .disc .val{color:#dc2626}
    .totals-box .grand{background:linear-gradient(90deg,#0f172a,#1e3a8a)}
    .totals-box .grand td{border-bottom:none;padding:10px 16px}
    .totals-box .grand .lbl{color:#bfdbfe;font-size:13px;font-weight:700}
    .totals-box .grand .val{color:#fff;font-size:15px;font-weight:900}
    .words{text-align:right;font-size:10.5px;font-style:italic;color:#64748b;margin-bottom:20px}

    /* ── PAYMENT BOX ── */
    .pay-card{border-radius:8px;overflow:hidden;border:1.5px solid #3b82f6;margin-bottom:20px}
    .pay-card-hdr{background:linear-gradient(90deg,#1e3a8a,#3b82f6);padding:8px 16px;font-size:10.5px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:1px}
    .pay-card-body{padding:12px 16px;background:#eff6ff}
    .pay-card-body table{width:100%;border-collapse:collapse}
    .pay-card-body td{padding:4px 0;font-size:13px}
    .pay-card-body .pl{color:#475569;font-weight:600;width:200px}
    .pay-card-body .pr{text-align:right;font-weight:700}
    .pay-card-body .advance{color:#16a34a}
    .pay-card-body .due-lbl{color:#dc2626;font-size:14px;font-weight:800}
    .pay-card-body .due-val{color:#dc2626;font-size:14px;font-weight:900;text-align:right}
    .pay-card-body .paid-lbl{color:#16a34a;font-weight:700}
    .pay-note{margin-top:8px;font-size:11px;color:#1d4ed8;font-style:italic;padding:6px 10px;background:#dbeafe;border-radius:4px}

    /* ── INFO CARDS (dispatch / warranty) ── */
    .info-card{border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:16px}
    .info-card-hdr{padding:8px 16px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#fff}
    .ic-dispatch .info-card-hdr{background:linear-gradient(90deg,#0f172a,#334155)}
    .ic-warranty .info-card-hdr{background:linear-gradient(90deg,#14532d,#16a34a)}
    .ic-tnc .info-card-hdr{background:linear-gradient(90deg,#374151,#6b7280)}
    .info-card-body{padding:12px 16px;background:#fff;font-size:12px}
    .info-card-body table{width:100%;border-collapse:collapse}
    .info-card-body td{padding:4px 10px 4px 0;vertical-align:top}
    .info-card-body td:first-child{font-weight:600;color:#64748b;width:160px;white-space:nowrap}
    .info-card-body td:last-child{color:#1e293b}
    .warranty-note{margin-top:8px;font-size:10.5px;color:#15803d;font-style:italic;padding:6px 10px;background:#f0fdf4;border-radius:4px}

    /* ── TERMS ── */
    .tnc-body{padding:10px 16px;background:#fff;font-size:11.5px;color:#475569;line-height:1.8}
    .tnc-body ol{padding-left:18px}

    /* ── FOOTER / SIGS ── */
    .sigs{display:flex;justify-content:space-between;gap:24px;margin-top:36px;padding-top:24px;border-top:1px dashed #cbd5e1}
    .sig-box{flex:1;text-align:center}
    .sig-line{height:48px;border-bottom:1.5px solid #334155;margin-bottom:6px}
    .sig-role{font-weight:700;font-size:12px;color:#0f172a}
    .sig-co{font-size:11px;color:#64748b;margin-top:2px}

    /* ── FOOTER BAND ── */
    .footer-band{background:#0f172a;padding:10px 36px;display:flex;justify-content:space-between;align-items:center;margin-top:32px}
    .footer-band span{font-size:10.5px;color:#64748b}
    .footer-band strong{color:#93c5fd}

    @media print{
      body{background:#fff}
      .page{box-shadow:none;margin:0;border-radius:0}
      .np{display:none}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
  </style></head><body>
  <div class="page">

  <!-- ══ HEADER BAND ══ -->
  <div class="hdr-band">
    <div class="hdr-logo">
      <img src="${logoUrl}" onerror="this.style.display='none'" />
      <div>
        <div class="hdr-co-name">Lyra Enterprises</div>
        <div class="hdr-co-sub">
          10/21, Vasuki Street, Ambattur, Chennai – 600053<br>
          Ph: 8122378860 &nbsp;·&nbsp; sales@lyraenterprise.co.in<br>
          GSTIN: 33DMYPR1025P1ZB
        </div>
      </div>
    </div>
    <div class="hdr-doc">
      <div class="hdr-doc-title">Tax Invoice</div>
      <div class="hdr-doc-badge">Original for Buyer</div>
      <div class="hdr-doc-sub" style="margin-top:6px">
        Order # <span>${o.order_number}</span><br>
        PI # <span>${o.pi_number || '—'}</span><br>
        ${o.lead_number ? `Lead # <span>${o.lead_number}</span><br>` : ''}
        Date &nbsp;<span>${fmt(d.dispatch_date)}</span>
      </div>
    </div>
  </div>

  <div class="body">

  <!-- ══ BILL TO / SHIP TO ══ -->
  <div class="addr-row">
    <div class="addr-card addr-bill">
      <div class="addr-card-hdr">Bill To</div>
      <div class="addr-card-body">
        <div class="name">${o.billing_name || o.customer_name}</div>
        ${o.company ? `<div class="co">${o.company}</div>` : ''}
        ${o.gst_number ? `<div><span class="gstin">GSTIN: ${o.gst_number}</span></div>` : ''}
        <div class="line" style="white-space:pre-wrap;margin-top:5px">${billAddr || '—'}</div>
        ${o.customer_phone ? `<div class="line" style="margin-top:4px">📞 ${o.customer_phone}</div>` : ''}
        ${o.customer_email ? `<div class="line">✉ ${o.customer_email}</div>` : ''}
      </div>
    </div>
    <div class="addr-card addr-ship">
      <div class="addr-card-hdr">Ship To</div>
      <div class="addr-card-body">
        <div class="name">${o.customer_name}</div>
        ${o.company ? `<div class="co">${o.company}</div>` : ''}
        <div class="line" style="white-space:pre-wrap;margin-top:5px">${shipAddr || '—'}</div>
        ${o.customer_phone ? `<div class="line" style="margin-top:4px;font-weight:600">📞 ${o.customer_phone}</div>` : ''}
        ${o.customer_email ? `<div class="line">✉ ${o.customer_email}</div>` : ''}
      </div>
    </div>
  </div>

  <!-- ══ ITEMS TABLE ══ -->
  <div class="tbl-wrap">
    <table class="items">
      <thead>
        <tr>
          <th style="width:36px;text-align:center">#</th>
          <th>Item</th>
          <th>Description</th>
          <th style="width:70px;text-align:center">HSN/SAC</th>
          <th style="width:70px;text-align:center">Qty</th>
          <th style="width:100px;text-align:right">Rate (excl. GST)</th>
          <th style="width:110px;text-align:right">Amount (excl. GST)</th>
          <th style="width:120px;text-align:right">Amount (incl. GST)</th>
        </tr>
      </thead>
      <tbody>
        ${productRows}
        ${freightRow}
        ${installRow}
      </tbody>
    </table>
  </div>

  <!-- ══ TOTALS ══ -->
  <div class="totals-wrap">
    <div class="totals-box">
      <table>
        <tr><td class="lbl">Sub Total</td><td class="val">₹ ${fmtN(subTotal)}</td></tr>
        ${disc > 0 ? `<tr class="disc"><td class="lbl">Less: Discount</td><td class="val">− ₹ ${fmtN(disc)}</td></tr>` : ''}
        <tr><td class="lbl" style="color:#64748b">Total GST (18%)</td><td class="val" style="color:#64748b">₹ ${fmtN(cgst + sgst + fCgst + fSgst + iCgst + iSgst)}</td></tr>
        <tr class="grand"><td class="lbl">Grand Total <span style="font-size:10px;font-weight:400;color:#94a3b8">(incl. 18% GST)</span></td><td class="val">₹ ${fmtN(grandTotal)}</td></tr>
      </table>
    </div>
  </div>
  <div class="words">${n2w(grandTotal)}</div>

  <!-- ══ PAYMENT SUMMARY ══ -->
  <div class="pay-card">
    <div class="pay-card-hdr">💳 Payment Summary</div>
    <div class="pay-card-body">
      <table>
        <tr><td class="pl">Invoice Amount</td><td class="pr">₹ ${fmtN(grandTotal)}</td></tr>
        ${amtPaid > 0 ? `<tr><td class="pl">Advance Received</td><td class="pr advance">₹ ${fmtN(amtPaid)}</td></tr>` : ''}
        <tr>
          <td class="${dueOnDlv > 0 ? 'due-lbl' : 'paid-lbl'}">${dueOnDlv > 0 ? 'Amount Due on Delivery' : '✅ Fully Paid'}</td>
          <td class="${dueOnDlv > 0 ? 'due-val' : 'pr advance'}">${dueOnDlv > 0 ? `₹ ${fmtN(dueOnDlv)}` : '₹ 0'}</td>
        </tr>
      </table>
      ${dueOnDlv > 0 ? `<div class="pay-note">⚠️ Please collect <strong>₹ ${fmtN(dueOnDlv)}</strong> at the time of delivery.</div>` : ''}
    </div>
  </div>

  <!-- ══ SERIAL NUMBER REGISTER ══ -->
  ${Object.keys(serialMap).length > 0 ? `
  <div class="info-card" style="border-color:#c7d2fe">
    <div class="info-card-hdr" style="background:linear-gradient(90deg,#312e81,#4f46e5)">🔢 Serial Number Register</div>
    <div class="info-card-body">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f5f3ff">
          <th style="padding:6px 10px;text-align:left;font-size:10.5px;color:#4f46e5;font-weight:700;border-bottom:1px solid #e0e7ff">#</th>
          <th style="padding:6px 10px;text-align:left;font-size:10.5px;color:#4f46e5;font-weight:700;border-bottom:1px solid #e0e7ff">Product</th>
          <th style="padding:6px 10px;text-align:left;font-size:10.5px;color:#4f46e5;font-weight:700;border-bottom:1px solid #e0e7ff">Serial Number(s)</th>
        </thead>
        <tbody>
          ${Object.entries(serialMap).map(([name, serials], i) => `
          <tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:6px 10px;color:#94a3b8;font-size:11px">${i+1}</td>
            <td style="padding:6px 10px;font-weight:600;font-size:12px">${name}</td>
            <td style="padding:6px 10px">${serials.map(s => `<span style="font-family:monospace;font-size:11.5px;font-weight:700;color:#1e1b4b;background:#ede9fe;border-radius:4px;padding:2px 8px;margin-right:6px;display:inline-block">${s}</span>`).join('')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>` : ''}

  <!-- ══ DISPATCH DETAILS ══ -->
  <div class="info-card ic-dispatch">
    <div class="info-card-hdr">📦 Dispatch Details</div>
    <div class="info-card-body">
      <table>
        <tr><td>Transporter</td><td>${d.transporter}</td></tr>
        <tr><td>LR / Docket #</td><td>${d.lr_number ? `<strong>${d.lr_number}</strong>` : '—'}</td></tr>
        <tr><td>Dispatch Date</td><td>${fmt(d.dispatch_date)}</td></tr>
        <tr><td>No. of Packages</td><td>${totalQty}</td></tr>
        <tr><td>Mode of Shipment</td><td>${d.transporter.toLowerCase().includes('self') ? 'Self Delivery' : 'Courier / Transport'}</td></tr>
        ${d.notes ? `<tr><td>Remarks</td><td>${d.notes}</td></tr>` : ''}
      </table>
    </div>
  </div>

  <!-- ══ WARRANTY ══ -->
  <div class="info-card ic-warranty">
    <div class="info-card-hdr">🛡️ Warranty Certificate – 1 Year Limited Warranty</div>
    <div class="info-card-body">
      <table>
        <tr><td>Warranty Period</td><td><strong>1 Year</strong> from date of dispatch</td></tr>
        <tr><td>Warranty Start</td><td>${fmt(wStart.toISOString())}</td></tr>
        <tr><td>Warranty Expiry</td><td><strong>${fmt(wEnd.toISOString())}</strong></td></tr>
        <tr><td>Covered</td><td>Manufacturing defects, electrical component failure under normal use conditions</td></tr>
        <tr><td>Not Covered</td><td>Physical damage, misuse, unauthorised repairs, consumables (coins, dispensable parts)</td></tr>
        <tr><td>Service Contact</td><td>8122378860 &nbsp;·&nbsp; sales@lyraenterprise.co.in</td></tr>
      </table>
      <div class="warranty-note">
        To claim warranty, quote Order # <strong>${o.order_number}</strong> and PI # <strong>${o.pi_number || '—'}</strong>.
        Unit must be returned to our service centre or our technician will visit within 7 working days of complaint registration.
      </div>
    </div>
  </div>

  <!-- ══ TERMS & CONDITIONS ══ -->
  <div class="info-card ic-tnc">
    <div class="info-card-hdr">Terms &amp; Conditions</div>
    <div class="tnc-body">
      <ol>
        <li>Goods once dispatched will not be accepted back without prior written approval from Lyra Enterprises.</li>
        <li>Risk of loss or damage during transit shall pass to the buyer upon handover to the transporter.</li>
        <li>Inspect the package immediately upon delivery. Report any transit damage within <strong>48 hours</strong> in writing.</li>
        <li>Warranty is void if the unit has been opened, tampered with, or repaired by unauthorised personnel.</li>
        <li>Payment disputes must be raised within 7 days of receiving this challan.</li>
        <li>All disputes subject to Chennai jurisdiction only.</li>
      </ol>
    </div>
  </div>

  <!-- ══ SIGNATURES ══ -->
  <div class="sigs">
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-role">Receiver's Signature</div>
      <div class="sig-co">${o.customer_name}</div>
      <div class="sig-co">Date: _______________</div>
    </div>
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-role">Prepared By</div>
      <div class="sig-co">Lyra Enterprises</div>
    </div>
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-role">Authorised Signatory</div>
      <div class="sig-co">Lyra Enterprises</div>
    </div>
  </div>

  </div><!-- /body -->

  <!-- ══ FOOTER BAND ══ -->
  <div class="footer-band">
    <span>Lyra Enterprises &nbsp;·&nbsp; GSTIN: <strong>33DMYPR1025P1ZB</strong></span>
    <span><strong>${o.order_number}</strong> &nbsp;·&nbsp; ${fmt(d.dispatch_date)}</span>
  </div>

  <div style="text-align:center;padding:16px" class="np">
    <button onclick="window.print()" style="padding:10px 32px;font-size:14px;cursor:pointer;background:linear-gradient(90deg,#1e3a8a,#3b82f6);color:#fff;border:none;border-radius:6px;font-weight:700;letter-spacing:.5px">🖨️ Print / Save as PDF</button>
  </div>

  </div><!-- /page -->
  </body></html>`);
  win.document.close(); win.focus();
}


export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/management') ? '/management' : '/production';

  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [techUsers, setTechUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [productCatalog, setProductCatalog] = useState<{ name: string; model_code: string; base_price: number; hsn_sac_code: string }[]>([]);

  useEffect(() => {
    api.get('/products').then(r => setProductCatalog((r.data as any[]).map((p: any) => ({ name: p.name, model_code: p.model_code, base_price: Number(p.base_price), hsn_sac_code: p.hsn_sac_code || '' })))).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/auth/users').then(r => {
      setTechUsers((r.data as any[]).filter(u => u.role === 'production' || u.role === 'management'));
    }).catch(() => {});
  }, []);

  // Modal states
  const [showFabModal, setShowFabModal] = useState(false);
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [labelSerials, setLabelSerials] = useState<string[]>([]);
  const [serialsLoading, setSerialsLoading] = useState(false);
  const [showTestingModal, setShowTestingModal] = useState(false);
  const [showPackingModal, setShowPackingModal] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [invoiceEmailSending, setInvoiceEmailSending] = useState(false);
  const [invoiceEmailMsg, setInvoiceEmailMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const sendInvoiceEmail = async () => {
    if (!order) return;
    setInvoiceEmailSending(true);
    setInvoiceEmailMsg(null);
    try {
      const r = await api.post(`/dispatch/${order.id}/send-invoice-email`, {});
      setInvoiceEmailMsg({ type: 'success', text: r.data.message || 'Email sent!' });
    } catch (e: any) {
      setInvoiceEmailMsg({ type: 'error', text: e.response?.data?.error || 'Failed to send email' });
    } finally {
      setInvoiceEmailSending(false);
      setTimeout(() => setInvoiceEmailMsg(null), 5000);
    }
  };
  const [showInstallModal, setShowInstallModal] = useState(false);

  // Forms
  const [fabForm, setFabForm] = useState({ received_date: todayIST(), notes: '' });
  const [fabUpdateForm, setFabUpdateForm] = useState({ status: 'RECEIVED', received_date: '', rework_reason: '' });
  const [assemblyForm, setAssemblyForm] = useState({ status: 'IN_PROGRESS', technician: '', notes: '' });
  const [testingUnits, setTestingUnits] = useState<Array<{
    label: string; sku: string; serial: string; type: 'vending' | 'incinerator';
    checks: Record<string, 'PASS' | 'FAIL'>;
  }>>([]);
  const [testingMeta, setTestingMeta] = useState({ tested_by: '', notes: '', failure_reason: '' });
  const [dispatchForm, setDispatchForm] = useState({ transporter: '', lr_number: '', dispatch_date: '', expected_delivery_date: '', delivery_address: '', notes: '' });
  const [packingUnits, setPackingUnits] = useState<Array<{
    label: string; sku: string; type: 'vending' | 'incinerator';
    checklist: Record<string, boolean>;
  }>>([]);
  const [packingMeta, setPackingMeta] = useState({ packed_by: '', notes: '' });
  const [installForm, setInstallForm] = useState({ status: 'IN_PROGRESS', engineer_name: '', installation_date: '', support_notes: '', feedback: '', rating: '' });

  const canEdit = user?.role === 'production' || user?.role === 'management';

  const fetchOrder = () => api.get(`/production/${id}`).then(r => { setOrder(r.data); setLoading(false); });
  useEffect(() => { fetchOrder(); }, [id]);

  // Pre-fill dispatch form with customer address when modal opens
  useEffect(() => {
    if (showDispatchModal && order) {
      const addr = order.delivery_address || order.address || '';
      setDispatchForm(p => ({
        ...p,
        dispatch_date: p.dispatch_date || todayIST(),
        delivery_address: p.delivery_address || addr,
      }));
    }
  }, [showDispatchModal]);

  // Initialize per-unit packing records when modal opens
  useEffect(() => {
    if (showPackingModal && order) {
      const products = parseOrderProducts(order.product_interest);
      const units: Array<{ label: string; sku: string; type: 'vending' | 'incinerator'; checklist: Record<string, boolean>; }> = [];
      for (const p of products) {
        for (let i = 0; i < p.qty; i++) {
          const type = getProductType(p.name, p.sku);
          units.push({
            label: p.qty > 1 ? `${p.name} #${i + 1}` : p.name,
            sku: p.sku,
            type,
            checklist: {},
          });
        }
      }
      setPackingUnits(units);
      setPackingMeta({ packed_by: '', notes: '' });
    }
  }, [showPackingModal]);

  // Fetch (or allocate) backend serials when label modal opens
  useEffect(() => {
    if (!showLabelModal || !order) return;
    const products = parseOrderProducts(order.product_interest);
    const items = products.map(p => ({ sku: p.sku, name: p.name, qty: p.qty }));
    setSerialsLoading(true);
    api.post(`/production/${order.id}/serials/allocate`, { items })
      .then(r => setLabelSerials((r.data as any[]).map((s: any) => s.serial_number)))
      .catch(() => {
        // fallback: local generation
        const serials: string[] = [];
        let gi = 0;
        for (const p of products) {
          for (let i = 0; i < p.qty; i++) { serials.push(genSerial(p.sku, gi, order.order_number)); gi++; }
        }
        setLabelSerials(serials);
      })
      .finally(() => setSerialsLoading(false));
  }, [showLabelModal]);

  // Initialize per-unit testing records when modal opens, prefill serials from backend
  useEffect(() => {
    if (!showTestingModal || !order) return;
    const products = parseOrderProducts(order.product_interest);
    let globalIdx = 0;
    const units: Array<{ label: string; sku: string; serial: string; type: 'vending' | 'incinerator'; checks: Record<string, 'PASS' | 'FAIL'>; }> = [];
    for (const p of products) {
      for (let i = 0; i < p.qty; i++) {
        const type = getProductType(p.name, p.sku);
        units.push({
          label: p.qty > 1 ? `${p.name} #${i + 1}` : p.name,
          sku: p.sku,
          serial: genSerial(p.sku, globalIdx, order.order_number), // placeholder, overwritten below
          type,
          checks: {},
        });
        globalIdx++;
      }
    }
    setTestingUnits(units);
    setTestingMeta({ tested_by: '', notes: '', failure_reason: '' });
    // Overwrite serials with backend-allocated ones (or allocate now)
    const items = products.map(p => ({ sku: p.sku, name: p.name, qty: p.qty }));
    api.post(`/production/${order.id}/serials/allocate`, { items })
      .then(r => {
        const allocated: any[] = r.data;
        setTestingUnits(prev => prev.map((u, i) => {
          const hit = allocated.find(s => s.unit_index === i);
          return hit ? { ...u, serial: hit.serial_number } : u;
        }));
      })
      .catch(() => {}); // keep placeholder on failure
  }, [showTestingModal]);

  const save = async (fn: () => Promise<void>) => {
    setSaving(true);
    try { await fn(); toast.success('Updated!'); fetchOrder(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400">Loading...</div>;
  if (!order) return <div className="text-gray-400 text-center py-10">Order not found</div>;

  const stages = [
    { key: 'PENDING', label: 'Pending', icon: '⏳' },
    { key: 'FABRICATION', label: 'Body QC', icon: '📦' },
    { key: 'ASSEMBLY', label: 'Assembly', icon: '🔩' },
    { key: 'TESTING', label: 'Testing', icon: '🔬' },
    { key: 'PACKAGING', label: 'Packaging', icon: '📦' },
    { key: 'DISPATCHED', label: 'Dispatched', icon: '🚚' },
    { key: 'INSTALLATION', label: 'Installation', icon: '⚙️' },
    { key: 'COMPLETED', label: 'Completed', icon: '✅' },
  ];

  const currentStageIdx = stages.findIndex(s => s.key === order.status);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button onClick={() => navigate(`${basePath}/orders`)} className="text-gray-400 hover:text-gray-600">←</button>
            <span className="font-mono text-xs text-gray-400">{order.order_number}</span>
            <OrderStatusBadge status={order.status} />
            <PriorityBadge priority={order.priority} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">{order.customer_name}</h1>
          <div className="text-gray-500 text-sm">{order.product_interest}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-gray-900">{formatCurrency(order.amount)}</div>
          <div className="text-xs text-gray-400">{order.pi_number}</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="card card-body">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1 shrink-0">
              {i > 0 && <div className={`w-6 h-px ${i <= currentStageIdx ? 'bg-blue-400' : 'bg-gray-200'}`} />}
              <div className={`flex flex-col items-center text-center`}>
                <div className={`text-lg`}>{s.icon}</div>
                <div className={`text-xs mt-0.5 ${i === currentStageIdx ? 'text-blue-600 font-semibold' : i < currentStageIdx ? 'text-green-600' : 'text-gray-300'}`}>
                  {s.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card card-body space-y-1 text-xs">
          <div className="font-semibold text-gray-500 uppercase tracking-wider mb-2">Customer</div>
          <div className="font-medium">{order.customer_name}</div>
          {(order as any).customer_phone && <div className="text-gray-500">{(order as any).customer_phone}</div>}
          {(order as any).customer_email && <div className="text-gray-500">{(order as any).customer_email}</div>}
          <div className="text-gray-400 font-mono">{order.lead_number}</div>
        </div>
        <div className="card card-body space-y-1 text-xs">
          <div className="font-semibold text-gray-500 uppercase tracking-wider mb-2">Timeline</div>
          <div>Created: {formatDate(order.created_at)}</div>
          <div>Updated: {formatDate(order.updated_at)}</div>
          {order.expected_delivery_date && <div className={`font-medium ${new Date(order.expected_delivery_date) < new Date() && order.status !== 'COMPLETED' ? 'text-red-500' : 'text-gray-700'}`}>
            Delivery: {formatDate(order.expected_delivery_date)}
          </div>}
        </div>
        <div className="card card-body space-y-1 text-xs">
          <div className="font-semibold text-gray-500 uppercase tracking-wider mb-2">Notes</div>
          <div className="text-gray-600 whitespace-pre-wrap">{order.notes || '—'}</div>
        </div>
      </div>

      {/* Stage Cards */}
      <div className="space-y-3">
        {/* ─── Body Receipt & QC ─── */}
        <StageCard
          title="📦 Body Receipt & QC"
          status={order.fabrication?.status}
          active={['PENDING','FABRICATION'].includes(order.status)}
          done={order.fabrication?.status === 'RECEIVED'}
        >
          {order.fabrication ? (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Supplier:</span> <strong>{order.fabrication.fabricator_name}</strong></div>
                <div><span className="text-gray-500">Received:</span> {formatDate(order.fabrication.sent_date)}</div>
                {(order.fabrication.defect_count ?? 0) > 0 && (
                  <div className="col-span-2">
                    <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                      ⚠️ Defective bodies: {order.fabrication.defect_count}
                    </span>
                  </div>
                )}
              {order.fabrication.rework_reason && <div className="col-span-2 text-red-500 text-xs">Last defect: {order.fabrication.rework_reason}</div>}
              </div>
              {order.fabrication.notes && <div className="text-gray-500 text-xs">{order.fabrication.notes}</div>}
              {canEdit && order.fabrication.status === 'SENT' && (
                <button onClick={() => setShowFabModal(true)} className="btn-primary btn-sm mt-2">Body QC Check</button>
              )}
              {canEdit && order.fabrication.status === 'REWORK' && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => save(async () => api.post(`/production/${id}/fabrication/${order.fabrication!.id}/replace`, {}))} className="btn-warning btn-sm">🔄 Replace Body & Re-test</button>
                </div>
              )}
            </div>
          ) : (
            canEdit && order.status === 'PENDING' && (
              <button
                disabled={saving}
                onClick={() => save(() => api.post(`/production/${id}/fabrication`, {}))}
                className="btn-primary btn-sm"
              >{saving ? '…' : 'Confirm Body Received'}</button>
            )
          )}
        </StageCard>

        {/* ─── Assembly ─── */}
        <StageCard title="🔩 Assembly" status={order.assembly?.status} active={order.status === 'ASSEMBLY'} done={order.assembly?.status === 'COMPLETED'}>
          {order.assembly && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {order.assembly.technician && <div><span className="text-gray-500">Technician:</span> <strong>{order.assembly.technician}</strong></div>}
                {order.assembly.started_at && <div><span className="text-gray-500">Started:</span> {formatDateTime(order.assembly.started_at)}</div>}
                {order.assembly.completed_at && <div><span className="text-gray-500">Completed:</span> {formatDateTime(order.assembly.completed_at)}</div>}
                {order.assembly.updated_at && <div className="col-span-2 text-xs text-gray-400">Last updated: {formatDateTime(order.assembly.updated_at)}</div>}
              </div>
              {order.assembly.notes && <div className="text-gray-500 text-xs">{order.assembly.notes}</div>}
              {canEdit && order.status === 'ASSEMBLY' && order.assembly.status !== 'COMPLETED' && (
                <button onClick={() => setShowAssemblyModal(true)} className="btn-primary btn-sm">Update Assembly</button>
              )}
            </div>
          )}
        </StageCard>

        {/* ─── Print Labels ─── */}
        <StageCard
          title="🏷️ Print Labels"
          status={undefined}
          active={order.assembly?.status === 'COMPLETED'}
          done={false}
        >
          {(() => {
            const units: { name: string; sku: string; qty: number }[] = parseOrderProducts(order.product_interest || '');
            const totalUnits = units.reduce((a, p) => a + p.qty, 0);
            return (
              <div className="space-y-2 text-sm">
                <div className="text-gray-600 text-xs">
                  Will print <strong>{totalUnits * 4} address labels</strong> + <strong>{totalUnits * 6} serial labels</strong> ({totalUnits} machine{totalUnits > 1 ? 's' : ''} × 4 address + 6 serial each).
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {units.map((p, pi) =>
                    Array.from({ length: p.qty }, (_, i) => (
                      <span key={`${pi}-${i}`} className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200">
                        {p.name}{p.qty > 1 ? ` #${i+1}` : ''}
                      </span>
                    ))
                  )}
                </div>
                <button
                  onClick={() => setShowLabelModal(true)}
                  className="btn-secondary btn-sm flex items-center gap-1.5"
                >
                  🏷️ Print Labels
                </button>
              </div>
            );
          })()}
        </StageCard>

        {/* ─── Testing ─── */}
        <StageCard title="🔬 Testing & QC" status={order.testing?.status} active={order.status === 'TESTING'} done={order.testing?.status === 'PASSED'}>
          {order.testing && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {order.testing.tested_by && <div><span className="text-gray-500">Tested by:</span> <strong>{order.testing.tested_by}</strong></div>}
                {order.testing.tested_at && <div><span className="text-gray-500">Tested:</span> {formatDateTime(order.testing.tested_at)}</div>}
              </div>
              {/* Per-item checklist results */}
              {order.testing.checklist_data && (() => {
                let cd: any;
                try {
                  cd = JSON.parse(order.testing.checklist_data);
                  // Handle double-encoded legacy records
                  if (typeof cd === 'string') cd = JSON.parse(cd);
                } catch {}
                if (cd?.version === 2 && Array.isArray(cd.units)) {
                  return (
                    <div className="space-y-2 mt-1">
                      {cd.units.map((unit: any, ui: number) => {
                        const { checks, label } = getQCChecks(unit.label, unit.sku || '');
                        return (
                          <div key={ui} className="border rounded overflow-hidden">
                            <div className="px-3 py-1.5 text-xs font-semibold bg-gray-50 border-b flex justify-between items-center">
                              <span>{unit.label} — {label}</span>
                              {unit.serial && <span className="font-mono text-blue-600 text-xs">{unit.serial}</span>}
                            </div>
                            {checks.map((c: string) => (
                              <div key={c} className={`flex items-center justify-between px-3 py-1.5 text-xs border-b last:border-b-0 ${unit.checks?.[c] === 'PASS' ? 'bg-green-50' : unit.checks?.[c] === 'FAIL' ? 'bg-red-50' : 'bg-gray-50'}`}>
                                <span>{c}</span>
                                <span className="font-semibold">{unit.checks?.[c] === 'PASS' ? '✅ Pass' : unit.checks?.[c] === 'FAIL' ? '❌ Fail' : '—'}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                // Legacy v1 format
                const v1: Record<string, 'PASS'|'FAIL'> = cd || {};
                const { checks, label } = getQCChecks(order.product_interest);
                return (
                  <div className="mt-1 border rounded overflow-hidden">
                    <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 border-b">{label}</div>
                    {checks.map(c => (
                      <div key={c} className={`flex items-center justify-between px-3 py-1.5 text-xs border-b last:border-b-0 ${v1[c] === 'PASS' ? 'bg-green-50' : v1[c] === 'FAIL' ? 'bg-red-50' : 'bg-gray-50'}`}>
                        <span>{c}</span>
                        <span className="font-semibold">{v1[c] === 'PASS' ? '✅ Pass' : v1[c] === 'FAIL' ? '❌ Fail' : '—'}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {order.testing.failure_reason && <div className="text-red-500 text-xs mt-1">Failure notes: {order.testing.failure_reason}</div>}
              {canEdit && order.status === 'TESTING' && order.testing.status === 'PENDING' && (
                <button onClick={() => setShowTestingModal(true)} className="btn-primary btn-sm">Submit Test Result</button>
              )}
            </div>
          )}
        </StageCard>

        {/* ─── Packing ─── */}
        <StageCard
          title="📦 Packing"
          status={order.packing?.status}
          active={order.status === 'PACKAGING' && order.packing?.status !== 'COMPLETED'}
          done={order.packing?.status === 'COMPLETED'}
        >
          <div className="space-y-2 text-sm">
            {order.packing?.status === 'COMPLETED' ? (
              <div className="space-y-1">
                {order.packing.packed_by && <div><span className="text-gray-500">Packed by:</span> <strong>{order.packing.packed_by}</strong></div>}
                {order.packing.packed_at && <div><span className="text-gray-500">Completed:</span> {formatDateTime(order.packing.packed_at)}</div>}
                {/* Show completed checklist */}
                {order.packing.checklist_data && (() => {
                  let cd: any;
                  try {
                    cd = JSON.parse(order.packing!.checklist_data!);
                    // Handle double-encoded legacy records
                    if (typeof cd === 'string') cd = JSON.parse(cd);
                  } catch {}
                  if (cd?.version === 2 && Array.isArray(cd.units)) {
                    return (
                      <div className="space-y-2 mt-1">
                        {cd.units.map((unit: any, ui: number) => {
                          const { checks, label } = getPackingChecks(unit.label || '', unit.sku || '');
                          return (
                            <div key={ui} className="border rounded overflow-hidden">
                              <div className="px-3 py-1.5 text-xs font-semibold bg-gray-50 border-b">{unit.label} — {label}</div>
                              {checks.map((c: string) => (
                                <div key={c} className={`flex items-center justify-between px-3 py-1.5 text-xs border-b last:border-b-0 ${unit.checklist?.[c] ? 'bg-green-50' : 'bg-red-50'}`}>
                                  <span>{c}</span>
                                  <span className="font-semibold">{unit.checklist?.[c] ? '✅ Packed' : '⬜ Missing'}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                  // Legacy v1 flat format
                  const v1: Record<string, boolean> = cd || {};
                  const { checks, label } = getPackingChecks(order.product_interest || '');
                  return (
                    <div className="mt-1 border rounded overflow-hidden">
                      <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 border-b">{label}</div>
                      {checks.map(c => (
                        <div key={c} className={`flex items-center justify-between px-3 py-1.5 text-xs border-b last:border-b-0 ${v1[c] ? 'bg-green-50' : 'bg-red-50'}`}>
                          <span>{c}</span>
                          <span className="font-semibold">{v1[c] ? '✅ Packed' : '⬜ Missing'}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ) : (
              canEdit && order.status === 'PACKAGING' && (
                <button onClick={() => setShowPackingModal(true)} className="btn-primary btn-sm">Start Packing Checklist</button>
              )
            )}
          </div>
        </StageCard>

        {/* ─── Dispatch ─── */}
        <StageCard title="🚚 Dispatch" status={order.dispatch?.status} active={['PACKAGING','DISPATCHED'].includes(order.status)} done={order.dispatch?.status === 'DELIVERED'}>
          {order.dispatch ? (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Transporter:</span> {order.dispatch.transporter}</div>
                {order.dispatch.lr_number && <div><span className="text-gray-500">LR #:</span> <strong>{order.dispatch.lr_number}</strong></div>}
                <div><span className="text-gray-500">Dispatched:</span> {formatDate(order.dispatch.dispatch_date)}</div>
                {order.dispatch.expected_delivery_date && <div><span className="text-gray-500">ETA:</span> {formatDate(order.dispatch.expected_delivery_date)}</div>}
              </div>
              {order.dispatch.delivery_address && (
                <div className="bg-gray-50 border rounded p-2 text-xs">
                  <div className="font-semibold text-gray-400 uppercase tracking-wide mb-1">Ship To</div>
                  <div className="whitespace-pre-wrap text-gray-700 font-medium">{order.customer_name}</div>
                  <div className="whitespace-pre-wrap text-gray-600 mt-0.5">{order.dispatch.delivery_address}</div>
                </div>
              )}
              <div className="flex gap-2 flex-wrap mt-2">
                <button onClick={() => printDispatchInvoice(order, order.dispatch!, productCatalog)} className="btn-primary btn-sm">📄 Tax Invoice</button>
                {order.customer_email && (
                  <button onClick={sendInvoiceEmail} disabled={invoiceEmailSending} className="btn-secondary btn-sm">
                    {invoiceEmailSending ? '⏳ Sending…' : '✉️ Send Invoice Email'}
                  </button>
                )}
                {canEdit && order.dispatch.status !== 'DELIVERED' && (
                  <button onClick={async () => save(() => api.patch(`/dispatch/${id}/dispatch/${order.dispatch!.id}`, { status: 'DELIVERED' }))} className="btn-success btn-sm">✅ Mark Delivered</button>
                )}
              </div>
              {invoiceEmailMsg && (
                <div className={`mt-2 text-xs px-3 py-2 rounded ${invoiceEmailMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {invoiceEmailMsg.type === 'success' ? '✅' : '❌'} {invoiceEmailMsg.text}
                </div>
              )}
            </div>
          ) : (
            canEdit && order.status === 'PACKAGING' && order.packing?.status === 'COMPLETED' && (
              <button onClick={() => setShowDispatchModal(true)} className="btn-primary btn-sm">Create Dispatch</button>
            )
          )}
        </StageCard>

        {/* ─── Installation ─── */}
        <StageCard title="⚙️ Installation" status={order.installation?.status} active={order.status === 'INSTALLATION'} done={order.installation?.status === 'COMPLETED'}>
          {order.installation && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {order.installation.engineer_name && <div><span className="text-gray-500">Engineer:</span> {order.installation.engineer_name}</div>}
                {order.installation.installation_date && <div><span className="text-gray-500">Date:</span> {formatDate(order.installation.installation_date)}</div>}
                {order.installation.rating && <div><span className="text-gray-500">Rating:</span> {'⭐'.repeat(order.installation.rating)}</div>}
              </div>
              {order.installation.support_notes && <div className="text-gray-600 text-xs">{order.installation.support_notes}</div>}
              {order.installation.feedback && <div className="text-green-600 text-xs">Feedback: {order.installation.feedback}</div>}
              {canEdit && order.status === 'INSTALLATION' && order.installation.status !== 'COMPLETED' && (
                <button onClick={() => setShowInstallModal(true)} className="btn-primary btn-sm">Update Installation</button>
              )}
            </div>
          )}
        </StageCard>
      </div>

      {/* ─── Modals ─── */}

      {/* Body QC Check Modal */}
      <Modal open={showFabModal} onClose={() => setShowFabModal(false)} title="Body QC Check">
        <div className="space-y-3">
          <div><label className="form-label">QC Result</label>
              <select className="form-select" value={fabUpdateForm.status} onChange={e => setFabUpdateForm(p => ({ ...p, status: e.target.value }))}>
                <option value="RECEIVED">✅ Body OK – proceed to Assembly</option>
                <option value="REWORK">⚠️ Body has defect – record &amp; replace later</option>
              </select>
            </div>
            {fabUpdateForm.status === 'REWORK' && <div><label className="form-label">Defect Description *</label><textarea className="form-textarea h-16" placeholder="Describe the defect..." value={fabUpdateForm.rework_reason} onChange={e => setFabUpdateForm(p => ({ ...p, rework_reason: e.target.value }))} /></div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowFabModal(false)} className="btn-secondary">Cancel</button>
              <button disabled={saving} onClick={() => save(async () => { await api.patch(`/production/${id}/fabrication/${order.fabrication!.id}`, fabUpdateForm); setShowFabModal(false); })} className={fabUpdateForm.status === 'RECEIVED' ? 'btn-success' : 'btn-warning'}>{saving ? '…' : fabUpdateForm.status === 'RECEIVED' ? 'Proceed to Assembly' : 'Record Defect'}</button>
            </div>
        </div>
      </Modal>

      {/* Assembly Modal */}
      <Modal open={showAssemblyModal} onClose={() => setShowAssemblyModal(false)} title="Update Assembly Status">
        <div className="space-y-3">
          <div><label className="form-label">Status</label>
            <select className="form-select" value={assemblyForm.status} onChange={e => setAssemblyForm(p => ({ ...p, status: e.target.value }))}>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
          <div><label className="form-label">Technician</label>
            <select className="form-select" value={assemblyForm.technician} onChange={e => setAssemblyForm(p => ({ ...p, technician: e.target.value }))}>
              <option value="">— Select technician —</option>
              {techUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          </div>
          <div><label className="form-label">Notes</label><textarea className="form-textarea h-16" value={assemblyForm.notes} onChange={e => setAssemblyForm(p => ({ ...p, notes: e.target.value }))} /></div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAssemblyModal(false)} className="btn-secondary">Cancel</button>
            <button disabled={saving} onClick={() => save(async () => { await api.patch(`/production/${id}/assembly`, assemblyForm); setShowAssemblyModal(false); })} className="btn-primary">{saving ? '…' : 'Update'}</button>
          </div>
        </div>
      </Modal>

      {/* Print Labels Modal */}
      <Modal open={showLabelModal} onClose={() => setShowLabelModal(false)} title="🏷️ Print Production Labels">
        {(() => {
          const products = parseOrderProducts(order.product_interest || '');
          const units: { label: string; sku: string }[] = [];
          for (const p of products) {
            for (let i = 0; i < p.qty; i++) {
              units.push({ label: p.qty > 1 ? `${p.name} #${i + 1}` : p.name, sku: p.sku });
            }
          }
          return (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Confirm / edit serial numbers, then click Print. Each machine gets <strong>4 address labels</strong> + <strong>6 serial labels</strong> ({units.length * 10} labels total).
              </p>

              {/* Address preview */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs space-y-0.5">
                <div className="font-semibold text-blue-700 mb-1">📮 Address (4 copies)</div>
                <div className="font-medium text-gray-800">{order.company || order.customer_name}</div>
                <div className="text-gray-600 whitespace-pre-wrap">{order.delivery_address || order.address || <span className="italic text-red-400">No address on file</span>}</div>
                {order.customer_phone && <div className="text-gray-600">📞 {order.customer_phone}</div>}
              </div>

              {/* Serial number inputs */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Serial Numbers (6 labels each)</div>
                {serialsLoading ? (
                  <div className="flex items-center justify-center py-4 gap-2 text-sm text-gray-500">
                    <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Allocating serial numbers…
                  </div>
                ) : (
                  units.map((u, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="text-xs text-gray-600 w-36 truncate shrink-0">{u.label}</div>
                      <input
                        type="text"
                        className="form-input flex-1 font-mono text-sm"
                        placeholder={genSerial(u.sku, idx, order.order_number)}
                        value={labelSerials[idx] || ''}
                        onChange={e => setLabelSerials(prev => { const n = [...prev]; n[idx] = e.target.value; return n; })}
                      />
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowLabelModal(false)} className="btn-secondary">Cancel</button>
                <button
                  onClick={() => { printProductionLabels(order, labelSerials); setShowLabelModal(false); }}
                  className="btn-primary flex items-center gap-1.5"
                  disabled={serialsLoading}
                >
                  🖨️ Print Labels
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Testing Modal */}
      <Modal open={showTestingModal} onClose={() => setShowTestingModal(false)} title="Submit QC Test Result">
        {(() => {
          const allUnitsComplete = testingUnits.every(u => {
            const { checks } = getQCChecks(u.label, u.sku);
            return checks.every(c => u.checks[c]);
          });
          const allPassed = testingUnits.length > 0 && testingUnits.every(u => {
            const { checks } = getQCChecks(u.label, u.sku);
            return checks.every(c => u.checks[c] === 'PASS');
          });
          const hasFails = testingUnits.some(u => Object.values(u.checks).includes('FAIL'));
          const totalChecks = testingUnits.reduce((sum, u) => sum + getQCChecks(u.label, u.sku).checks.length, 0);
          const doneChecks = testingUnits.reduce((sum, u) => sum + Object.values(u.checks).filter(Boolean).length, 0);
          return (
            <div className="space-y-4">
              {testingUnits.map((unit, ui) => {
                const { checks, label } = getQCChecks(unit.label, unit.sku);
                const unitDone = checks.filter(c => unit.checks[c]).length;
                const unitAllPassed = checks.every(c => unit.checks[c] === 'PASS');
                const unitHasFail = checks.some(c => unit.checks[c] === 'FAIL');
                const setCheck = (c: string, v: 'PASS' | 'FAIL') =>
                  setTestingUnits(prev => prev.map((u, i) => i === ui ? { ...u, checks: { ...u.checks, [c]: v } } : u));
                return (
                  <div key={ui} className="border rounded-lg overflow-hidden">
                    {/* Unit header */}
                    <div className={`px-3 py-2 flex items-center justify-between text-sm font-semibold border-b ${
                      unitDone === 0 ? 'bg-gray-50 text-gray-700'
                      : unitAllPassed && unitDone === checks.length ? 'bg-green-50 text-green-700'
                      : unitHasFail ? 'bg-red-50 text-red-700'
                      : 'bg-yellow-50 text-yellow-700'
                    }`}>
                      <span>{unit.label} — {label}</span>
                      <span className="text-xs font-normal text-gray-400">{unitDone}/{checks.length} marked</span>
                    </div>
                    {/* Serial number */}
                    <div className="px-3 py-2 bg-blue-50 border-b flex items-center gap-2">
                      <span className="text-xs text-blue-600 font-medium shrink-0">Serial No:</span>
                      <input
                        className="font-mono text-xs border border-blue-200 rounded px-2 py-1 flex-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        value={unit.serial}
                        onChange={e => setTestingUnits(prev => prev.map((u, i) => i === ui ? { ...u, serial: e.target.value } : u))}
                        placeholder="Auto-generated — edit if needed"
                      />
                    </div>
                    {/* Checklist */}
                    {checks.map(c => (
                      <div key={c} className={`flex items-center justify-between px-3 py-2 border-b last:border-b-0 text-sm ${
                        unit.checks[c] === 'PASS' ? 'bg-green-50' : unit.checks[c] === 'FAIL' ? 'bg-red-50' : 'bg-white'
                      }`}>
                        <span>{c}</span>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => setCheck(c, 'PASS')}
                            className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                              unit.checks[c] === 'PASS' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-green-100'
                            }`}>✅ Pass</button>
                          <button type="button" onClick={() => setCheck(c, 'FAIL')}
                            className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                              unit.checks[c] === 'FAIL' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-red-100'
                            }`}>❌ Fail</button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {testingUnits.length > 1 && (
                <div className="text-xs text-gray-400 text-right">{doneChecks}/{totalChecks} checks completed across {testingUnits.length} units</div>
              )}
              <div><label className="form-label">Tested By</label>
                <select className="form-select" value={testingMeta.tested_by} onChange={e => setTestingMeta(p => ({ ...p, tested_by: e.target.value }))}>
                  <option value="">— Select technician —</option>
                  {techUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
              </div>
              {hasFails && (
                <div><label className="form-label">Failure Details <span className="text-red-500">*</span></label>
                  <textarea className="form-textarea h-16" placeholder="Describe what failed..." value={testingMeta.failure_reason} onChange={e => setTestingMeta(p => ({ ...p, failure_reason: e.target.value }))} />
                </div>
              )}
              <div><label className="form-label">Notes</label>
                <textarea className="form-textarea h-14" value={testingMeta.notes} onChange={e => setTestingMeta(p => ({ ...p, notes: e.target.value }))} />
              </div>
              {allUnitsComplete && (
                <div className={`text-xs font-semibold px-3 py-2 rounded ${
                  allPassed ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {allPassed
                    ? `✅ All ${testingUnits.length} unit(s) passed — order will proceed to Packaging`
                    : `❌ ${testingUnits.filter(u => { const { checks } = getQCChecks(u.label, u.sku); return checks.some(c => u.checks[c] === 'FAIL'); }).length} unit(s) have failures — status will be FAILED`}
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowTestingModal(false)} className="btn-secondary">Cancel</button>
                <button
                  disabled={saving || !allUnitsComplete || (hasFails && !testingMeta.failure_reason.trim())}
                  onClick={() => save(async () => {
                    await api.patch(`/production/${id}/testing`, {
                      status: allPassed ? 'PASSED' : 'FAILED',
                      checklist_completed: allPassed ? 1 : 0,
                      checklist_data: JSON.stringify({ version: 2, units: testingUnits }),
                      failure_reason: testingMeta.failure_reason || null,
                      tested_by: testingMeta.tested_by || null,
                      notes: testingMeta.notes || null,
                    });
                    setShowTestingModal(false);
                  })}
                  className={allPassed ? 'btn-success' : 'btn-danger'}
                >{saving ? '…' : allPassed ? '✅ Submit — All Passed' : '❌ Submit — Mark Failed'}</button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Packing Modal */}
      <Modal open={showPackingModal} onClose={() => setShowPackingModal(false)} title="Packing Checklist">
        {(() => {
          const allUnitsComplete = packingUnits.length > 0 && packingUnits.every(u => {
            const { checks } = getPackingChecks(u.label, u.sku);
            return checks.every(c => u.checklist[c]);
          });
          const totalChecks = packingUnits.reduce((sum, u) => sum + getPackingChecks(u.label, u.sku).checks.length, 0);
          const doneChecks = packingUnits.reduce((sum, u) => sum + Object.values(u.checklist).filter(Boolean).length, 0);
          return (
            <div className="space-y-4">
              {packingUnits.map((unit, ui) => {
                const { checks, label } = getPackingChecks(unit.label, unit.sku);
                const unitDone = checks.filter(c => unit.checklist[c]).length;
                const unitAllDone = unitDone === checks.length;
                const setItem = (c: string, v: boolean) =>
                  setPackingUnits(prev => prev.map((u, i) => i === ui ? { ...u, checklist: { ...u.checklist, [c]: v } } : u));
                return (
                  <div key={ui} className="border rounded-lg overflow-hidden">
                    <div className={`px-3 py-2 flex items-center justify-between text-sm font-semibold border-b ${
                      unitAllDone ? 'bg-green-50 text-green-700' : unitDone > 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-gray-50 text-gray-700'
                    }`}>
                      <span>{unit.label} — {label}</span>
                      <span className="text-xs font-normal text-gray-400">{unitDone}/{checks.length} confirmed</span>
                    </div>
                    {checks.map(c => (
                      <label key={c} className={`flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0 cursor-pointer text-sm transition-colors ${
                        unit.checklist[c] ? 'bg-green-50' : 'bg-white hover:bg-gray-50'
                      }`}>
                        <input
                          type="checkbox"
                          checked={!!unit.checklist[c]}
                          onChange={e => setItem(c, e.target.checked)}
                          className="w-4 h-4 accent-green-600"
                        />
                        <span className={unit.checklist[c] ? 'line-through text-gray-400' : ''}>{c}</span>
                        {unit.checklist[c] && <span className="ml-auto text-green-600 text-xs font-semibold">✅ Packed</span>}
                      </label>
                    ))}
                  </div>
                );
              })}
              {packingUnits.length > 1 && (
                <div className="text-xs text-gray-400 text-right">{doneChecks}/{totalChecks} items confirmed across {packingUnits.length} units</div>
              )}
              <div><label className="form-label">Packed By</label>
                <select className="form-select" value={packingMeta.packed_by} onChange={e => setPackingMeta(p => ({ ...p, packed_by: e.target.value }))}>
                  <option value="">— Select technician —</option>
                  {techUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
              </div>
              <div><label className="form-label">Notes</label><textarea className="form-textarea h-14" value={packingMeta.notes} onChange={e => setPackingMeta(p => ({ ...p, notes: e.target.value }))} /></div>
              {allUnitsComplete && (
                <div className="text-xs font-semibold px-3 py-2 rounded bg-green-50 text-green-700 border border-green-200">
                  ✅ All {packingUnits.length} unit(s) packed — ready for dispatch
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowPackingModal(false)} className="btn-secondary">Cancel</button>
                <button
                  disabled={saving || !allUnitsComplete}
                  onClick={() => save(async () => {
                    await api.patch(`/production/${id}/packing`, {
                      status: 'COMPLETED',
                      checklist_data: JSON.stringify({ version: 2, units: packingUnits }),
                      packed_by: packingMeta.packed_by || null,
                      notes: packingMeta.notes || null,
                    });
                    setShowPackingModal(false);
                  })}
                  className="btn-success"
                >{saving ? '…' : '✅ Complete Packing'}</button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Dispatch Modal */}
      <Modal open={showDispatchModal} onClose={() => setShowDispatchModal(false)} title="Create Dispatch">
        <div className="space-y-3">
          {/* Customer shipping address block */}
          {(order.delivery_address || order.address) ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">📦 Customer Shipping Address</div>
              <div className="font-semibold text-sm">{order.customer_name}{order.company ? ` – ${order.company}` : ''}</div>
              <div className="text-xs text-gray-700 whitespace-pre-wrap mt-1">{order.delivery_address || order.address}</div>
              {order.customer_phone && <div className="text-xs text-gray-500 mt-1">📞 {order.customer_phone}</div>}
            </div>
          ) : (
            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
              ⚠️ No delivery address on record for this customer. Please fill manually below.
            </div>
          )}
          <div><label className="form-label">Transporter *</label><input className="form-input" value={dispatchForm.transporter} onChange={e => setDispatchForm(p => ({ ...p, transporter: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="form-label">LR Number</label><input className="form-input" value={dispatchForm.lr_number} onChange={e => setDispatchForm(p => ({ ...p, lr_number: e.target.value }))} /></div>
            <div><label className="form-label">Dispatch Date *</label><input type="date" className="form-input" value={dispatchForm.dispatch_date} onChange={e => setDispatchForm(p => ({ ...p, dispatch_date: e.target.value }))} /></div>
            <div><label className="form-label">Expected Delivery</label><input type="date" className="form-input" value={dispatchForm.expected_delivery_date} onChange={e => setDispatchForm(p => ({ ...p, expected_delivery_date: e.target.value }))} /></div>
          </div>
          <div><label className="form-label">Delivery Address</label><textarea className="form-textarea h-16" value={dispatchForm.delivery_address} onChange={e => setDispatchForm(p => ({ ...p, delivery_address: e.target.value }))} /></div>
          <div><label className="form-label">Notes</label><textarea className="form-textarea h-12" value={dispatchForm.notes} onChange={e => setDispatchForm(p => ({ ...p, notes: e.target.value }))} /></div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowDispatchModal(false)} className="btn-secondary">Cancel</button>
            <button disabled={saving} onClick={() => save(async () => { await api.post(`/dispatch/${id}`, dispatchForm); setShowDispatchModal(false); })} className="btn-primary">{saving ? '…' : 'Dispatch'}</button>
          </div>
        </div>
      </Modal>

      {/* Installation Modal */}
      <Modal open={showInstallModal} onClose={() => setShowInstallModal(false)} title="Update Installation">
        <div className="space-y-3">
          <div><label className="form-label">Status</label>
            <select className="form-select" value={installForm.status} onChange={e => setInstallForm(p => ({ ...p, status: e.target.value }))}>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="form-label">Engineer Name</label><input className="form-input" value={installForm.engineer_name} onChange={e => setInstallForm(p => ({ ...p, engineer_name: e.target.value }))} /></div>
            <div><label className="form-label">Installation Date</label><input type="date" className="form-input" value={installForm.installation_date} onChange={e => setInstallForm(p => ({ ...p, installation_date: e.target.value }))} /></div>
          </div>
          <div><label className="form-label">Support Notes</label><textarea className="form-textarea h-16" value={installForm.support_notes} onChange={e => setInstallForm(p => ({ ...p, support_notes: e.target.value }))} /></div>
          {installForm.status === 'COMPLETED' && <>
            <div><label className="form-label">Customer Feedback</label><textarea className="form-textarea h-16" value={installForm.feedback} onChange={e => setInstallForm(p => ({ ...p, feedback: e.target.value }))} /></div>
            <div><label className="form-label">Rating (1-5)</label>
              <select className="form-select" value={installForm.rating} onChange={e => setInstallForm(p => ({ ...p, rating: e.target.value }))}>
                <option value="">Select</option>
                {[1,2,3,4,5].map(r => <option key={r} value={r}>{r} - {'⭐'.repeat(r)}</option>)}
              </select>
            </div>
          </>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowInstallModal(false)} className="btn-secondary">Cancel</button>
            <button disabled={saving} onClick={() => save(async () => { await api.patch(`/installation/${id}`, installForm); setShowInstallModal(false); })} className={installForm.status === 'COMPLETED' ? 'btn-success' : 'btn-primary'}>{saving ? '…' : 'Update'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StageCard({ title, status, active, done, children }: {
  title: string; status?: string; active: boolean; done: boolean; children?: React.ReactNode
}) {
  return (
    <div className={`card ${active ? 'ring-2 ring-blue-400' : done ? 'opacity-70' : 'opacity-50'}`}>
      <div className={`card-header ${active ? 'bg-blue-50' : done ? 'bg-green-50' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{title}</span>
          {done && <span className="badge-green text-xs">Done</span>}
          {active && !done && <span className="badge-blue text-xs">Active</span>}
          {status && <span className="badge-gray text-xs">{status}</span>}
        </div>
      </div>
      {children && <div className="card-body">{children}</div>}
    </div>
  );
}
