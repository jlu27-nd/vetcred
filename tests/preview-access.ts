import type { BrowserContext } from '@playwright/test';

/** Short-lived access to this project's preview; never sent to Storage. */
export function previewHeaders(): Record<string, string> {
  const target = process.env.PLAYWRIGHT_BASE_URL;
  return process.env.VETCRED_USE_PREVIEW_OIDC === '1' && target &&
    new URL(target).hostname.endsWith('.vercel.app') && process.env.VERCEL_OIDC_TOKEN
    ? { 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN }
    : {};
}

export async function scopePreviewHeaders(context: BrowserContext, baseURL?: string) {
  const trusted = previewHeaders();
  if (!baseURL || !Object.keys(trusted).length) return;
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    const headers = { ...route.request().headers() };
    delete headers['x-vercel-trusted-oidc-idp-token'];
    if (new URL(route.request().url()).origin === origin) Object.assign(headers, trusted);
    await route.continue({ headers });
  });
}
