// PDF text extraction via pdf.js. Dynamically imported so the sizeable PDF
// library only loads when the user actually imports a PDF.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(arrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map(it => (it && it.str) || '').join(' '));
  }
  return parts.join('\n');
}
