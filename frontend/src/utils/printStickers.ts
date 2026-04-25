import QRCode from 'qrcode';

function escapeHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Generate a print popup containing one 2" × 1" QR sticker per unit.
 * Each QR encodes `${origin}/inventory/use?unit=<id>` — scanning deducts 1 from stock.
 * `totalEver` is the all-time total units ever registered for this component, shown as "of N".
 */
export async function printStickerSheet(
  units: { id: string; unit_seq: number }[],
  totalEver: number,
  componentName: string,
  sku: string | undefined | null,
  location: string | undefined | null,
  category: string | undefined | null,
  origin: string,
): Promise<void> {
  if (units.length === 0) return;

  // Generate all QR data-URLs in parallel
  const qrUrls = await Promise.all(
    units.map((u) =>
      QRCode.toDataURL(`${origin}/inventory/use?unit=${u.id}`, {
        width: 200,
        margin: 1,
        errorCorrectionLevel: 'M',
      }),
    ),
  );

  const stickersHtml = qrUrls
    .map(
      (qr, i) => `
    <div class="sticker">
      <div class="qr"><img src="${qr}" alt="QR"/></div>
      <div class="info">
        <div class="name">${escapeHtml(componentName)}</div>
        ${sku ? `<div class="row">SKU: <b>${escapeHtml(sku)}</b></div>` : ''}
        ${category ? `<div class="row">${escapeHtml(category)}</div>` : ''}
        ${location ? `<div class="row">\u{1F4CD} ${escapeHtml(location)}</div>` : ''}
        <div class="serial">#${String(units[i].unit_seq).padStart(4, '0')} of ${totalEver}</div>
      </div>
    </div>`,
    )
    .join('');

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { alert('Please allow popups to print stickers.'); return; }

  w.document.write(`<!DOCTYPE html>
<html><head><title>QR Stickers \u2014 ${escapeHtml(componentName)}</title>
<style>
  @page { size: auto; margin: 0.25in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; font-family: Arial, sans-serif; }
  h3 { font-size: 8pt; color: #888; margin-bottom: 6pt; }
  .grid { display: flex; flex-wrap: wrap; gap: 3pt; }
  .sticker {
    width: 2in; height: 1in;
    display: flex; align-items: center;
    border: 0.5pt solid #bbb; padding: 3pt 4pt; gap: 4pt;
    background: white; break-inside: avoid; page-break-inside: avoid;
  }
  .qr { width: 0.82in; height: 0.82in; flex-shrink: 0; }
  .qr img { width: 100%; height: 100%; display: block; }
  .info { flex: 1; overflow: hidden; }
  .name   { font-size: 7.5pt; font-weight: bold; line-height: 1.25; word-break: break-word; }
  .row    { font-size: 6pt; color: #333; margin-top: 1.5pt; }
  .serial { font-size: 5pt; color: #aaa; margin-top: 3pt; font-family: monospace; }
</style>
</head>
<body>
  <h3>${escapeHtml(componentName)}${sku ? ' · ' + escapeHtml(sku) : ''} — ${units.length} sticker${units.length !== 1 ? 's' : ''}</h3>
  <div class="grid">${stickersHtml}</div>
  <script>window.onload=function(){window.print();window.close();}<\/script>
</body></html>`);
  w.document.close();
}
