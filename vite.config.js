import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0'
  },
  build: {
    outDir: 'dist',
    // OCR 的 wasm core 与语言包体积较大，不参与 chunk 拆分的告警阈值判断
    chunkSizeWarningLimit: 1024
  }
});
