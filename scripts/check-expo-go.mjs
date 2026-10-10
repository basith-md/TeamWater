#!/usr/bin/env node
// Offline prepublish guard. Store/device compatibility must be verified before
// intentionally changing scripts/expo-go-target.json; this never guesses latest.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const problems = [];
try {
  const targetFile = join(root, 'scripts/expo-go-target.json');
  if (!existsSync(targetFile)) throw new Error('Missing scripts/expo-go-target.json. Verify the intended ordinary Expo Go version using current official Expo documentation and the actual target phones, then declare the supported SDK/React/React Native target.');
  const target = read(targetFile);
  if (!Number.isInteger(target.expoSdk) || target.expoSdk < 1 || !/^\d+\.\d+$/.test(target.react ?? '') || !/^\d+\.\d+$/.test(target.reactNative ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(target.verifiedAt ?? '') || !/^https:\/\/(?:docs\.)?expo\.dev\//.test(target.source ?? '')) throw new Error('Invalid Expo Go target: include expoSdk, react and reactNative major.minor families, verifiedAt date, and an official Expo source URL.');
  const manifests = [join(root, 'package.json')];
  const project = read(manifests[0]);
  for (const pattern of project.workspaces ?? []) {
    if (typeof pattern !== 'string') throw new Error('Unsupported workspace declaration; use a package path or one-level path/* glob.');
    if (pattern.endsWith('/*')) {
      const directory = join(root, pattern.slice(0, -2));
      if (existsSync(directory)) for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) {
        const manifest = join(directory, entry.name, 'package.json'); if (existsSync(manifest)) manifests.push(manifest);
      }
    } else if (!pattern.includes('*')) manifests.push(join(root, pattern, 'package.json'));
    else throw new Error(`Unsupported workspace glob: ${pattern}`);
  }
  function check(name, version, location) {
    const parsed = /^([~^]?)(\d+)\.(\d+)\.(\d+)$/.exec(version);
    const family = parsed ? `${parsed[2]}.${parsed[3]}` : null;
    const expected = name === 'expo' ? `SDK ${target.expoSdk}` : name === 'react-native' ? target.reactNative : target.react;
    const compatible = parsed && (name === 'expo' ? Number(parsed[2]) === target.expoSdk : family === expected)
      && !(name !== 'expo' && Number(parsed[2]) > 0 && parsed[1] === '^');
    if (!compatible) problems.push(`${location}: ${name} ${version} does not stay within declared Expo Go ${expected}. Pin a compatible stable version; React caret ranges can resolve an incompatible minor.`);
  }
  let expoFound = false;
  for (const manifest of new Set(manifests)) {
    const pkg = read(manifest);
    for (const section of ['dependencies', 'devDependencies']) for (const name of ['expo', 'react', 'react-dom', 'react-native']) {
      const version = pkg[section]?.[name];
      if (version === undefined) continue;
      if (name === 'expo') expoFound = true;
      // POSIX separators so messages read the same on Windows and macOS.
      check(name, version, `${relative(root, manifest).split(sep).join('/')} ${section}`);
    }
  }
  if (!expoFound) problems.push('No Expo dependency found in the project or declared workspaces.');
  const lock = join(root, 'package-lock.json');
  if (existsSync(lock)) for (const [path, pkg] of Object.entries(read(lock).packages ?? {})) {
    const name = /(?:^|\/)node_modules\/(expo|react|react-dom|react-native)$/.exec(path)?.[1];
    if (name && pkg.version) check(name, pkg.version, `package-lock.json ${path}`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Declared Expo Go target SDK ${target.expoSdk} matches project versions (React ${target.react}, React Native ${target.reactNative}).`);
  console.log(`Target reviewed ${target.verifiedAt}: ${target.source}`);
  console.log('This checks the declared target only; run Expo dependency checks and both platform exports, and verify the launch on a physical phone before sharing.');
} catch (error) {
  console.error(`Expo Go compatibility check failed:\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
