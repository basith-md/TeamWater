import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { 'react-native': 'react-native-web' }, dedupe: ['react', 'react-dom'] },
  test: { environment: 'jsdom', include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'], restoreMocks: true }
});
