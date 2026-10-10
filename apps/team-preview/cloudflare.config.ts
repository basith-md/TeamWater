import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  accountId: '7e6f4eefce31ea6bcf39328898a01c65',
  worker: {
    name: 'chrp-team',
    compatibilityDate: '2026-10-06',
    entrypoint: './src/worker.ts',
    workersDev: true,
    assets: { runWorkerFirst: true, notFoundHandling: 'single-page-application' },
    env: {
      ASSETS: bindings.assets(),
      BACKEND_URL: bindings.secret(),
      ORIGIN_TOKEN: bindings.secret(),
      TEAM_PASSWORD: bindings.secret(),
      SESSION_SECRET: bindings.secret(),
      LOGIN_LIMITER: bindings.rateLimit({ namespace: '10102026', simple: { limit: 10, period: 60 } }),
    },
  },
});
