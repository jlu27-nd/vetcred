import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const tracePath = resolve('.next/server/app/api/command/route.js.nft.json');
const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as { files: string[] };
const files = trace.files.map(file => file.replace(/\\/g, '/'));
const absoluteFiles = files.map(file => resolve(dirname(tracePath), file));
const normalize = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
const symlinks = absoluteFiles.filter(file => existsSync(file) && lstatSync(file).isSymbolicLink());
for (const symlink of symlinks) {
  const prefix = `${normalize(symlink)}${sep}`;
  if (absoluteFiles.some(file => normalize(file).startsWith(prefix))) {
    throw new Error('PDF function trace includes files beneath a symlink directory; resolve include paths to their physical locations.');
  }
}
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
console.log(`PDF runtime trace verified: worker, canvas runtime and ${process.platform}/${process.arch} native binding; no files beneath traced symlinks.`);
