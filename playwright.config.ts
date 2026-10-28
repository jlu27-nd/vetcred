import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  testDir:'./tests',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,
  timeout:600_000,expect:{timeout:15_000},retries:0,
  reporter:'list',
  use:{baseURL:process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:3000',
    trace:'off',video:'off',screenshot:'only-on-failure',
    ...(process.platform==='win32'?{channel:'msedge'}:{}),
  },
});
