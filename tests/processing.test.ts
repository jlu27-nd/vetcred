import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import { DOCX_MIME, extractDocument, inspectFile, isSampleAudio, isSampleResume, sanitizePhoto, SAMPLE_RESUME, validateUpload } from '../src/lib/processing';

function pdf(pages:string[]) {
  const objects:string[]=['<< /Type /Catalog /Pages 2 0 R >>',''];
  const kids:number[]=[];
  for(const text of pages){const page=objects.length+1; kids.push(page); const stream=`BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g,'\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${page+1} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);}
  objects[1]=`<< /Type /Pages /Kids [${kids.map(id=>`${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let body='%PDF-1.7\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(body));body+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

// Minimal stored ZIP fixture builder; no parser mocks are used in extraction tests.
function zip(entries:Record<string,string>, dishonestExpansion=false) {
  const local:Buffer[]=[];const central:Buffer[]=[];let offset=0;
  for(const [name,text] of Object.entries(entries)) {
    const data=Buffer.from(text),fileName=Buffer.from(name);const payload=dishonestExpansion?deflateRawSync(data):data;
    const size=dishonestExpansion?1:data.length;const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(dishonestExpansion?8:0,8);h.writeUInt32LE(payload.length,18);h.writeUInt32LE(size,22);h.writeUInt16LE(fileName.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(dishonestExpansion?8:0,10);c.writeUInt32LE(payload.length,20);c.writeUInt32LE(size,24);c.writeUInt16LE(fileName.length,28);c.writeUInt32LE(offset,42);
    const chunk=Buffer.concat([h,fileName,payload]);local.push(chunk);central.push(Buffer.concat([c,fileName]));offset+=chunk.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length,8);end.writeUInt16LE(central.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
function docx() {return zip({
  '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Medical supply coordination.</w:t></w:r></w:p><w:p><w:r><w:t>Training in 2021; end date uncertain.</w:t></w:r></w:p></w:body></w:document>',
});}

describe('real document and media processing',()=>{
  it('enforces type, extension, size and empty-file limits',()=>{
    expect(()=>validateUpload({kind:'photo',name:'kit.png',mime:'image/png',size:100})).not.toThrow();
    expect(()=>validateUpload({kind:'photo',name:'secret.html',mime:'image/png',size:100})).toThrow('JPEG');
    expect(()=>validateUpload({kind:'audio',name:'story.wav',mime:'audio/wav',size:25*1024*1024})).toThrow('too large');
    expect(()=>validateUpload({kind:'resume',name:'resume.txt',mime:'text/plain',size:0})).toThrow('empty');
  });
  it('rejects bytes that spoof image MIME types',async()=>{
    await expect(inspectFile(Buffer.from('<script>steal()</script>'),'image/png','photo')).rejects.toThrow('contents');
  });
  it('extracts UTF-8 text with exact stable line locators',async()=>{
    const result=await extractDocument(Buffer.from('First role\n\nSecond role in 2024'),'text/plain');
    expect(result).toEqual([{locator:'Text line 1',text:'First role'},{locator:'Text line 3',text:'Second role in 2024'}]);
  });
  it('extracts a real two-page PDF with resolvable page references',async()=>{
    const result=await extractDocument(pdf(['Coordinated medical supplies.','Education completed in 2023.']),'application/pdf');
    expect(result).toEqual([{locator:'PDF page 1',text:'Coordinated medical supplies.'},{locator:'PDF page 2',text:'Education completed in 2023.'}]);
  },15000);
  it('extracts DOCX paragraphs and preserves uncertainty',async()=>{
    const result=await extractDocument(docx(),DOCX_MIME);
    expect(result).toEqual([{locator:'DOCX paragraph 1',text:'Medical supply coordination.'},{locator:'DOCX paragraph 2',text:'Training in 2021; end date uncertain.'}]);
  });
  it('rejects scanned/empty PDF and binary or empty text',async()=>{
    await expect(extractDocument(pdf(['']),'application/pdf')).rejects.toThrow('No readable text');
    await expect(extractDocument(Buffer.from('     \n   '),'text/plain')).rejects.toThrow('No readable text');
    await expect(extractDocument(Buffer.from([0,1,2,3]),'text/plain')).rejects.toThrow('binary');
  });
  it('bounds DOCX decompression even if the ZIP headers lie',async()=>{
    await expect(extractDocument(zip({'word/document.xml':'x'.repeat(300000)},true),DOCX_MIME)).rejects.toThrow();
  });
  it('removes original EXIF metadata from shareable photo derivatives',async()=>{
    const original=await sharp({create:{width:128,height:96,channels:3,background:'#246963'}}).withExif({IFD0:{Copyright:'Private original metadata'},IFD3:{GPSLatitude:'40/1 26/1 0/1',GPSLongitude:'79/1 58/1 0/1'}}).jpeg().toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const derivative=await sanitizePhoto(original);const metadata=await sharp(derivative).metadata();
    expect(metadata.format).toBe('webp');expect(metadata.exif).toBeUndefined();expect(metadata.xmp).toBeUndefined();expect(metadata.iptc).toBeUndefined();
  });
  it('recognizes fixtures by content hash and never arbitrary user uploads',()=>{
    expect(isSampleResume(Buffer.from(SAMPLE_RESUME))).toBe(true);expect(isSampleResume(Buffer.from(SAMPLE_RESUME+'changed'))).toBe(false);
    const audio=readFileSync(new URL('../public/sample/story.wav',import.meta.url));expect(isSampleAudio(audio)).toBe(true);expect(isSampleAudio(Buffer.from('not the sample'))).toBe(false);
  });
});
