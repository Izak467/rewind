/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/rewind/', // GitHub Pages serves the site under /rewind/
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
