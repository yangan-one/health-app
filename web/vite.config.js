import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // 把体积大的依赖单独拆包：业务代码改动不会让浏览器重新下 echarts
        manualChunks: {
          echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    // 监听 0.0.0.0：手机连同一个 Wi-Fi 就能用 http://<电脑局域网IP>:5173 打开
    // （本机仍是 localhost，局域网地址见启动日志里的 Network 一行）
    host: true,
    port: 5173,
    // 忽略编辑器/工具产生的临时目录，避免 Windows 上 watcher 因 EBUSY 崩溃
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/.tmp/**', '**/dist/**'],
    },
    // 开发时把 /api 转发到后端，前端代码里就能直接用相对路径，不用处理跨域
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
