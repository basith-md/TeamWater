import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: '../mobile/dist',
  plugins: [cloudflare({ types: { includeRuntime: false } })],
});
