// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/check-expo-go.mjs');
const roots: string[] = [];
function file(root: string, path: string, content: unknown) {
  const parts = path.split('/'); parts.pop(); mkdirSync(join(root, ...parts), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify(content));
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'teamwater-expo-go-')); roots.push(root);
  // Historical SDK54 tuple verifies the generic guard, not today's store availability.
  file(root, 'scripts/expo-go-target.json', { expoSdk: 54, react: '19.1', reactNative: '0.81', verifiedAt: '2025-09-10', source: 'https://docs.expo.dev/versions/v54.0.0/' });
  file(root, 'package.json', { workspaces: ['apps/*', 'packages/*'], dependencies: { react: '19.1.0', 'react-dom': '19.1.0' } });
  file(root, 'apps/mobile/package.json', { dependencies: { expo: '~54.0.31', react: '19.1.0', 'react-native': '0.81.5' } });
  return root;
}
const check = (root: string) => spawnSync(process.execPath, [script, root], { encoding: 'utf8', timeout: 10000 });
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

describe('declared Expo Go launch target', () => {
  it('accepts compatible declared and locked packages without asserting physical phone success', () => {
    const root = fixture(); file(root, 'package-lock.json', { packages: { 'node_modules/expo': { version: '54.0.31' }, 'node_modules/react': { version: '19.1.0' }, 'node_modules/react-native': { version: '0.81.5' } } });
    const result = check(root); expect(result.status).toBe(0); expect(result.stdout).toContain('Declared Expo Go target SDK 54'); expect(result.stdout).toContain('physical phone');
  });
  it('blocks exporting an Expo SDK different from the declared phone target', () => {
    const root = fixture(); file(root, 'apps/mobile/package.json', { dependencies: { expo: '~57.0.27', react: '19.1.0', 'react-native': '0.81.5' } });
    const result = check(root); expect(result.status).toBe(1); expect(result.stderr).toContain('apps/mobile/package.json'); expect(result.stderr).toContain('SDK 54'); expect(result.stderr).toContain('57.0.27');
  });
  it.each([['react', '19.2.3'], ['react-native', '0.86.3'], ['react', '^19.1.0']])('blocks incompatible or unbounded workspace %s version %s', (name, version) => {
    const root = fixture(); file(root, 'packages/mobile-ui/package.json', { dependencies: { [name]: version } });
    const result = check(root); expect(result.status).toBe(1); expect(result.stderr).toContain('packages/mobile-ui/package.json'); expect(result.stderr).toContain(name); expect(result.stderr).toContain(version);
  });
  it('rejects an incompatible nested locked React copy even when declarations are compatible', () => {
    const root = fixture(); file(root, 'package-lock.json', { packages: { 'node_modules/react': { version: '19.1.0' }, 'apps/mobile/node_modules/react': { version: '19.2.3' } } });
    const result = check(root); expect(result.status).toBe(1); expect(result.stderr).toContain('apps/mobile/node_modules/react'); expect(result.stderr).toContain('19.2.3');
  });
  it('requires an explicitly verified target rather than silently assuming the newest SDK', () => {
    const root = fixture(); rmSync(join(root, 'scripts/expo-go-target.json'));
    const result = check(root); expect(result.status).toBe(1); expect(result.stderr).toContain('expo-go-target.json'); expect(result.stderr).toContain('official');
  });
});
