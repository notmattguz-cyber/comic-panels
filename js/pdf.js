// A tiny PDF writer: one JPEG image per page, page size taken from the comic page.
import { renderPage, MAX_PIXELS } from './render-canvas.js';

// Points per pixel: the comic page is 300 dpi print size; screen formats come out at a readable size.
const PT = (page) => (page.format === 'comic' || page.format === 'spread' ? 72 / 300 : 0.5);

export async function makePDF(pages, { sketch = false, onProgress } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  let pos = 0;
  const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
  const begin = (n) => { offsets[n] = pos; push(`${n} 0 obj\n`); };
  const end = () => push('\nendobj\n');

  push('%PDF-1.4\n%âãÏÓ\n');
  const kids = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (onProgress) onProgress(i, pages.length);
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (page.w * page.h)) * 0.95);
    const cv = await renderPage(page, { scale, sketch });
    const W = cv.width, H = cv.height;
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
    cv.width = 0;
    const jpg = new Uint8Array(await blob.arrayBuffer());
    const ptW = (page.w * PT(page)).toFixed(2), ptH = (page.h * PT(page)).toFixed(2);
    const pageN = 3 + i * 3, contN = pageN + 1, imgN = pageN + 2;
    kids.push(`${pageN} 0 R`);

    begin(imgN);
    push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    push(jpg);
    push('\nendstream');
    end();

    const content = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`;
    begin(contN);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    end();

    begin(pageN);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>`);
    end();
  }
  begin(1); push('<< /Type /Catalog /Pages 2 0 R >>'); end();
  begin(2); push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`); end();

  const n = 3 + pages.length * 3;
  const xref = pos;
  let x = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  if (onProgress) onProgress(pages.length, pages.length);
  return new Blob(chunks, { type: 'application/pdf' });
}
