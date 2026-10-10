import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'react-native': 'react-native-web' }, dedupe: ['react', 'react-dom'] },
  server: { proxy: {
    '/api': { target: process.env.TEAMWATER_BACKEND_URL || 'http://127.0.0.1:8000', ws: true, changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') },
    // Water Connect is mounted inside the mesh service; its pages and links live under /connect.
    '/connect': { target: process.env.TEAMWATER_BACKEND_URL || 'http://127.0.0.1:8000', changeOrigin: true },
  } },
});
