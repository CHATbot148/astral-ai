import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'xml', 'yml', 'yaml', 'toml', 'log', 'rtf',
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'sql', 'html', 'css',
]);
const WORD_EXTENSIONS = new Set(['docx']);
const PDF_EXTENSIONS = new Set(['pdf']);
const MAX_TEXT_CHARS_PER_FILE = 14_000;
const MAX_TOTAL_CHARS = 28_000;
const MAX_PDF_PAGES = 12;

if (typeof window !== 'undefined' && GlobalWorkerOptions.workerSrc !== pdfWorkerUrl) {
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

const getExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() ?? '';

const normalizeExtractedText = (value: string) => value.replace(/\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim();

const truncateText = (value: string, limit: number) => {
  if (value.length <= limit) return { text: value, truncated: false };
  return { text: `${value.slice(0, limit)}\n\n[truncated]`, truncated: true };
};

async function parsePdf(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const pagesToRead = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (lines) pageTexts.push(`[Page ${pageNumber}] ${lines}`);
  }

  return {
    label: `${pdf.numPages}-page PDF`,
    text: normalizeExtractedText(pageTexts.join('\n\n')),
    truncatedByPageLimit: pdf.numPages > MAX_PDF_PAGES,
  };
}

async function parseDocx(file: File) {
  const mammoth = await import('mammoth/mammoth.browser');
  const result = await (mammoth as any).extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return {
    label: 'Word document',
    text: normalizeExtractedText(result.value || ''),
    warnings: Array.isArray(result.messages) ? result.messages.length : 0,
  };
}

async function parsePlainText(file: File) {
  return {
    label: 'Text document',
    text: normalizeExtractedText(await file.text()),
  };
}

export async function buildAttachmentContext(files: File[]) {
  if (!files.length) return undefined;

  let remaining = MAX_TOTAL_CHARS;
  const sections = await Promise.all(files.map(async (file, index) => {
    const ext = getExtension(file.name);
    const mime = file.type || 'unknown';

    if (file.type.startsWith('image/')) {
      return `${index + 1}. ${file.name} (image)\nImage attachment included for visual inspection.`;
    }

    if (file.type.startsWith('video/')) {
      return `${index + 1}. ${file.name} (video)\nVideo attachment included for visual inspection.`;
    }

    if (file.type.startsWith('audio/')) {
      return `${index + 1}. ${file.name} (audio)\nAudio attachment included.`;
    }

    try {
      let parsed:
        | { label: string; text: string; truncatedByPageLimit?: boolean; warnings?: number }
        | null = null;

      if (PDF_EXTENSIONS.has(ext) || mime === 'application/pdf') {
        parsed = await parsePdf(file);
      } else if (WORD_EXTENSIONS.has(ext) || mime.includes('wordprocessingml')) {
        parsed = await parseDocx(file);
      } else if (TEXT_EXTENSIONS.has(ext) || /^text\//i.test(mime)) {
        parsed = await parsePlainText(file);
      }

      if (!parsed) {
        return `${index + 1}. ${file.name} (${ext || mime})\nText extraction is not available for this file type.`;
      }

      if (!parsed.text) {
        return `${index + 1}. ${file.name} (${parsed.label})\nNo readable text was extracted.`;
      }

      const safeLimit = Math.max(0, Math.min(MAX_TEXT_CHARS_PER_FILE, remaining));
      const { text, truncated } = truncateText(parsed.text, safeLimit);
      remaining = Math.max(0, remaining - text.length);
      const notes = [
        parsed.truncatedByPageLimit ? `Only the first ${MAX_PDF_PAGES} pages were read.` : null,
        truncated ? 'Text was truncated for length.' : null,
        parsed.warnings ? `Parsing warnings: ${parsed.warnings}.` : null,
      ].filter(Boolean);

      return `${index + 1}. ${file.name} (${parsed.label})${notes.length ? `\n${notes.join(' ')}` : ''}\nExtracted text:\n"""\n${text}\n"""`;
    } catch (error) {
      return `${index + 1}. ${file.name} (${ext || mime})\nI couldn't extract text from this file: ${error instanceof Error ? error.message : 'unknown error'}.`;
    }
  }));

  return `Attached files with extracted context:\n\n${sections.join('\n\n')}`;
}