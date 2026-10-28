import type { NextConfig } from 'next';
const config: NextConfig = {
  outputFileTracingIncludes: {
    '/api/**/*': ['./supabase/certs/*.crt', './public/sample/**/*'],
    '/share/**/*': ['./supabase/certs/*.crt'],
    // PDF.js loads its worker and native canvas through runtime imports that
    // static tracing cannot discover. Include both npm and pnpm layouts.
    '/api/command': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/package.json',
      './node_modules/@napi-rs/canvas/**/*',
      './node_modules/@napi-rs/canvas-*/**/*',
      './node_modules/.pnpm/@napi-rs+canvas*/node_modules/@napi-rs/canvas*/**/*',
    ],
  },
  serverExternalPackages: ['sharp', 'pg', 'pdfjs-dist', '@napi-rs/canvas'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' }] }];
  },
};
export default config;
