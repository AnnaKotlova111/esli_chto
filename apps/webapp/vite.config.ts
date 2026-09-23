import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
  server: { host: '0.0.0.0', port: 5173 },
});
