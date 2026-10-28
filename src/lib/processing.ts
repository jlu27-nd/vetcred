import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import mammoth from 'mammoth';
import type { Asset } from './types';

export type AssetKind = Asset['kind'];
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const UPLOAD_LIMITS = { photo: 10 * 1024 * 1024, resume: 8 * 1024 * 1024, support: 8 * 1024 * 1024, audio: 24 * 1024 * 1024 } as const;
export const MAX_DOCUMENT_CHARACTERS = 80000;

export class DocumentRuntimeUnavailableError extends Error {
  constructor() {
    super('PDF processing is temporarily unavailable. Retry later, or paste the document text manually.');
    this.name = 'DocumentRuntimeUnavailableError';
  }
}

export function isPdfRuntimeFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? String(error.code) : '';
  return /^(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)$/.test(code) ||
    /Cannot (?:find|load) (?:module|package)|DOMMatrix is not defined|Setting up fake worker failed|workerSrc|native binding/i.test(error.message);
}
const types: Record<AssetKind, Record<string, string[]>> = {
  photo: { 'image/jpeg':['jpg','jpeg'], 'image/png':['png'], 'image/webp':['webp'] },
  resume: { 'application/pdf':['pdf'], [DOCX_MIME]:['docx'], 'text/plain':['txt'] },
  support: { 'application/pdf':['pdf'], [DOCX_MIME]:['docx'], 'text/plain':['txt'] },
  audio: { 'audio/mpeg':['mp3','mpeg','mpga'], 'audio/mp3':['mp3'], 'audio/mp4':['m4a','mp4'], 'audio/x-m4a':['m4a'], 'video/mp4':['mp4','m4a'], 'audio/wav':['wav'], 'audio/x-wav':['wav'], 'audio/webm':['webm'], 'video/webm':['webm'] },
};
export const SAMPLE_TRANSCRIPT = 'During a unit training exercise, supplies were scattered across several kits. I made an inventory checklist, organized the kits, and explained the new layout to the team. The team could find supplies more easily. That experience showed me why clear processes and communication matter.';
export const SAMPLE_RESUME = `Alex Morgan — fictional sample veteran
Career direction: Healthcare operations
Service: U.S. Army, Combat Medic (68W), 2018–2024, Fort Liberty, North Carolina
Responsibilities: Organized medical supply kits and maintained inventory checklists during training exercises.
Accomplishment: Explained a new kit layout to colleagues so they could find supplies more easily.
Education: Associate of Science, General Studies, Sample Community College, 2023
Training: Combat Medic Specialist Training, 2018 (self-reported; not independently verified)
Credential: Basic Life Support training stated in 2022; current status not supplied.
This resume is synthetic and does not describe a real person. Military occupation suggests questions; it does not establish individual qualifications.
`;

export function validateUpload(input: {kind:AssetKind;name:string;mime:string;size:number}): void {
  if (!Object.hasOwn(types, input.kind)) throw new Error('Unsupported upload category.');
  const mime = input.mime.split(';')[0].trim().toLowerCase();
  const extension = input.name.split('.').at(-1)?.toLowerCase();
  if (!input.name || input.name.length > 240 || /[\u0000-\u001f]/.test(input.name)) throw new Error('Use a file name of 1–240 characters.');
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new Error('The file is empty. Choose a non-empty file.');
  if (input.size > UPLOAD_LIMITS[input.kind]) throw new Error(`This file is too large. ${input.kind === 'audio' ? 'Audio' : input.kind === 'photo' ? 'Photos' : 'Documents'} must be ${UPLOAD_LIMITS[input.kind] / 1024 / 1024} MB or smaller.`);
  if (!extension || !types[input.kind][mime]?.includes(extension)) throw new Error(input.kind === 'photo' ? 'Choose a JPEG, PNG, or WebP image.' : input.kind === 'audio' ? 'Choose an MP3, M4A, MP4, MPEG, WAV, or WebM audio file.' : 'Choose a text-based PDF, DOCX, or TXT document.');
}

function decodeText(buffer: Buffer): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal:true }).decode(buffer); }
  catch { throw new Error('This TXT file is not readable UTF-8 text. Save it as UTF-8 or paste the text manually.'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('The file contains binary data. Choose a text document or paste the text manually.');
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** Bound compressed and actual inflated bytes before passing untrusted DOCX to Mammoth. */
function validateDocxArchive(buffer: Buffer): void {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0,buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error('The DOCX archive is unreadable. Export it again or paste the text manually.');
  const count = buffer.readUInt16LE(end + 10), start = buffer.readUInt32LE(end + 16);
  if (count > 2000 || count === 0 || start >= end || buffer.readUInt16LE(end+4) !== 0 || buffer.readUInt16LE(end+6) !== 0) throw new Error('This DOCX archive exceeds the supported document limits.');
  let offset = start, total = 0, hasDocument = false;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('The DOCX archive is damaged.');
    const flags = buffer.readUInt16LE(offset+8), method=buffer.readUInt16LE(offset+10), compressed = buffer.readUInt32LE(offset+20), expanded = buffer.readUInt32LE(offset+24);
    const nameLength=buffer.readUInt16LE(offset+28), extra=buffer.readUInt16LE(offset+30), comment=buffer.readUInt16LE(offset+32), local=buffer.readUInt32LE(offset+42);
    const name = buffer.subarray(offset+46,offset+46+nameLength).toString('utf8');
    total += expanded;
    if (flags & 1 || ![0,8].includes(method) || expanded > 8*1024*1024 || total > 32*1024*1024 || expanded > Math.max(compressed*200,1024*1024) || local+30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('This DOCX archive exceeds the safe processing limits.');
    const dataStart=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
    if (dataStart+compressed > start) throw new Error('The DOCX archive is damaged.');
    const content=buffer.subarray(dataStart,dataStart+compressed);
    const decoded=method===8 ? inflateRawSync(content,{maxOutputLength:Math.max(expanded,1)}) : content;
    if (decoded.length!==expanded) throw new Error('The DOCX archive has invalid file lengths.');
    if (name==='word/document.xml') hasDocument=true;
    offset+=46+nameLength+extra+comment;
  }
  if (!hasDocument) throw new Error('This file is not a Word DOCX document.');
}

export async function inspectFile(buffer: Buffer, declaredMime: string, kind: AssetKind): Promise<void> {
  const mime=declaredMime.split(';')[0].trim().toLowerCase();
  if (!types[kind]?.[mime]) throw new Error('This file type is not supported for the selected upload category.');
  if (!buffer.length || buffer.length > UPLOAD_LIMITS[kind]) throw new Error('The uploaded file is empty or exceeds the size limit.');
  if (mime==='text/plain') { decodeText(buffer); return; }
  if (mime===DOCX_MIME) {
    try { validateDocxArchive(buffer); }
    catch { throw new Error('The DOCX archive is unreadable or exceeds safe processing limits. Export it again or paste the text manually.'); }
    return;
  }
  const actual=await fileTypeFromBuffer(buffer);
  const aliases: Record<string,string[]> = { 'audio/mpeg':['audio/mpeg'], 'audio/mp3':['audio/mpeg'], 'audio/wav':['audio/wav','audio/vnd.wave','audio/x-wav'], 'audio/x-wav':['audio/wav','audio/vnd.wave','audio/x-wav'], 'audio/webm':['audio/webm','video/webm'], 'video/webm':['audio/webm','video/webm'], 'audio/mp4':['audio/mp4','video/mp4','audio/x-m4a'], 'audio/x-m4a':['audio/mp4','video/mp4','audio/x-m4a'], 'video/mp4':['audio/mp4','video/mp4','audio/x-m4a'] };
  if (!actual || !(aliases[mime] ?? [mime]).includes(actual.mime)) throw new Error('The file contents do not match its type. Export the file again and retry.');
  if (kind==='photo') {
    const metadata=await sharp(buffer,{limitInputPixels:40_000_000,failOn:'error'}).metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1)>1) throw new Error('Choose a single, readable photo rather than an animated image.');
  }
}

export async function sanitizePhoto(buffer: Buffer): Promise<Buffer> {
  // Sharp strips all EXIF/XMP/IPTC metadata unless metadata preservation is explicitly requested.
  return sharp(buffer,{limitInputPixels:40_000_000,failOn:'error'}).rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
}

function checkExtraction(segments:{locator:string;text:string}[]) {
  const total=segments.reduce((count,segment)=>count+segment.text.length,0);
  if (total < 10 || !segments.some(segment=>/[\p{L}\p{N}]/u.test(segment.text))) throw new Error('No readable text was found. This may be a scanned document. Upload a text-based PDF, DOCX, or TXT file, or paste the text manually.');
  if (total>MAX_DOCUMENT_CHARACTERS || segments.length>1000) throw new Error('This document is too long to process safely. Upload a shorter excerpt or paste the relevant text.');
  return segments;
}

export async function extractDocument(buffer: Buffer, mime: string): Promise<{locator:string;text:string}[]> {
  await inspectFile(buffer,mime,'resume');
  try {
    if (mime==='text/plain') {
      const lines=decodeText(buffer).split('\n');
      return checkExtraction(lines.map((text,index)=>({locator:`Text line ${index+1}`,text:text.trim()})).filter(segment=>segment.text));
    }
    if (mime===DOCX_MIME) {
      const {value}=await mammoth.extractRawText({buffer});
      return checkExtraction(value.split('\n\n').map((text,index)=>({locator:`DOCX paragraph ${index+1}`,text:text.trim()})).filter(segment=>segment.text));
    }
    if (mime!=='application/pdf') throw new Error('Unsupported document format.');
    let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
    try {
      // Load the published native implementation explicitly. PDF.js uses it
      // for its own DOM geometry polyfills; no custom polyfills are installed.
      await import('@napi-rs/canvas');
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
      throw new DocumentRuntimeUnavailableError();
    }
    const { getDocument } = pdfjs;
    const task=getDocument({data:new Uint8Array(buffer),useSystemFonts:false,disableFontFace:true,maxImageSize:40_000_000,verbosity:0});
    const timer=setTimeout(()=>void task.destroy(),25_000);
    try {
      const pdf=await task.promise;
      if (pdf.numPages>30) throw new Error('This PDF has more than 30 pages. Upload a shorter excerpt or paste the relevant text.');
      const segments:{locator:string;text:string}[]=[];
      for (let pageIndex=1;pageIndex<=pdf.numPages;pageIndex++) {
        const page=await pdf.getPage(pageIndex);
        const content=await page.getTextContent();
        const text=content.items.map(item=>'str' in item ? item.str : '').join(' ').replace(/\s+/g,' ').trim();
        if (text) segments.push({locator:`PDF page ${pageIndex}`,text});
        if (segments.reduce((n,segment)=>n+segment.text.length,0)>MAX_DOCUMENT_CHARACTERS) throw new Error('This document is too long to process safely. Upload a shorter excerpt or paste the relevant text.');
        page.cleanup();
      }
      return checkExtraction(segments);
    } finally { clearTimeout(timer); await task.destroy(); }
  } catch (error) {
    if (error instanceof DocumentRuntimeUnavailableError) throw error;
    if (mime === 'application/pdf' && isPdfRuntimeFailure(error)) throw new DocumentRuntimeUnavailableError();
    if (error instanceof Error && /readable|long|30 pages|Unsupported|UTF-8|binary/.test(error.message)) throw error;
    throw new Error('The document could not be read. It may be damaged, password-protected, or scanned. Export a text-based copy or paste the text manually.');
  }
}

export function sampleHash(bytes:Buffer|string) { return createHash('sha256').update(bytes).digest('hex'); }
export function isSampleResume(buffer:Buffer) { return sampleHash(buffer)===sampleHash(SAMPLE_RESUME); }
export const SAMPLE_AUDIO_SHA256='d292abf8dbc9b67cfee9db3abed623b11201fd36bef3ec56117e07e7c577fb34';
export function isSampleAudio(buffer:Buffer) { return sampleHash(buffer)===SAMPLE_AUDIO_SHA256; }
