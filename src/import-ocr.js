// Optical character recognition for screenshots and photos, via
// tesseract.js. Dynamically imported so the OCR engine only loads on use.
import Tesseract from 'tesseract.js';

export async function ocrImage(file) {
  const { data } = await Tesseract.recognize(file, 'eng');
  return (data && data.text) || '';
}
