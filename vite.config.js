import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    // 开发环境代理公众号页面与图片，绕过浏览器 CORS（仅 dev 生效；
    // 原生 App 用 CapacitorHttp，不依赖此代理）
    proxy: {
      '/wx-proxy': {
        target: 'https://mp.weixin.qq.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wx-proxy/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      },
      '/wx-img': {
        target: 'https://mmbiz.qpic.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wx-img/, ''),
        headers: { Referer: 'https://mp.weixin.qq.com/' }
      }
    }
  },
  build: {
    outDir: 'dist',
    // OCR 的 wasm core 与语言包体积较大，不参与 chunk 拆分的告警阈值判断
    chunkSizeWarningLimit: 1024
  }
});
