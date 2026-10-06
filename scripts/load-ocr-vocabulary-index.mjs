import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import '../assets/js/ocr-vocabulary-index.js';

// Node image batches decode exactly the same artifact and codec as the browser.
export async function loadOcrVocabularyIndex() {
  const directory = new URL('../assets/data/', import.meta.url);
  const metadata = JSON.parse(await readFile(new URL('ocr-vocabulary-index.meta.json', directory)));
  if (metadata.compression !== 'gzip' || !/^ocr-vocabulary-index\.[a-f0-9]{16}\.bin$/.test(metadata.file?.file || '')) throw new Error('Invalid OCR vocabulary filename/compression');
  const bytes = await readFile(new URL(metadata.file.file, directory));
  if (bytes.length !== metadata.file.bytes || createHash('sha256').update(bytes).digest('hex') !== metadata.file.sha256) {
    throw new Error('OCR vocabulary bytes/SHA-256 mismatch');
  }
  return globalThis.OcrVocabularyIndex.readResponse(new Response(bytes), metadata);
}
