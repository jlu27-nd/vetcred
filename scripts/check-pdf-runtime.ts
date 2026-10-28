import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const tracePath = resolve('.next/server/app/api/command/route.js.nft.json');
const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as { files: string[] };
const files = trace.files.map(file => file.replace(/\\/g, '/'));
const required = [
  { name: 'PDF.js worker', match: (file: string) => file.endsWith('/pdfjs-dist/legacy/build/pdf.worker.mjs') },
  { name: 'canvas JavaScript runtime', match: (file: string) => file.endsWith('/@napi-rs/canvas/index.js') },
  { name: `${process.platform}/${process.arch} canvas native binding`, match: (file: string) => file.includes(`/@napi-rs/canvas-${process.platform}-${process.arch}-`) && file.endsWith('.node') },
];
for (const dependency of required) {
  const matches = files.filter(dependency.match);
  if (!matches.some(file => existsSync(resolve(dirname(tracePath), file)))) {
    throw new Error(`PDF runtime tracing is incomplete: missing ${dependency.name}.`);
  }
}
console.log(`PDF runtime trace verified: worker, canvas runtime and ${process.platform}/${process.arch} native binding.`);
