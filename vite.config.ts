import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
