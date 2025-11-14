import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../public'),
    emptyOutDir: true
    // 移除 rollupOptions，使用默认的 index.html
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});
