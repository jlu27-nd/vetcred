import type { NextConfig } from 'next';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';

const projectRoot = process.cwd();
const runtimeRequire = createRequire(resolve(projectRoot, 'package.json'));
const tracePath = (path: string) => `./${relative(projectRoot, realpathSync(path)).split(sep).join('/')}`;
const canvasPackage = realpathSync(runtimeRequire.resolve('@napi-rs/canvas/package.json'));
const canvasRequire = createRequire(canvasPackage);
const canvasMetadata = JSON.parse(readFileSync(canvasPackage, 'utf8')) as { optionalDependencies?: Record<string, string> };
const nativePackagePaths = Object.keys(canvasMetadata.optionalDependencies ?? {}).flatMap(name => {
  try { return [`${tracePath(dirname(canvasRequire.resolve(`${name}/package.json`)))}/**/*`]; }
  catch { return []; } // Native packages for other operating systems are absent.
});

const config: NextConfig = {
  outputFileTracingIncludes: {
    '/api/**/*': ['./supabase/certs/*.crt', './public/sample/**/*'],
    '/share/**/*': ['./supabase/certs/*.crt'],
    // Include canonical physical paths only. Including children of pnpm's
    // symlink directories creates an invalid Vercel function package.
    '/api/command': [
      tracePath(runtimeRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')),
      tracePath(runtimeRequire.resolve('pdfjs-dist/package.json')),
      `${tracePath(dirname(canvasPackage))}/**/*`,
      ...nativePackagePaths,
    ],
  },
  serverExternalPackages: ['sharp', 'pg', 'pdfjs-dist', '@napi-rs/canvas'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' }] }];
  },
};
export default config;
