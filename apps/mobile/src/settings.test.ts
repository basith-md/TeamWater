import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialSettings, backendUrl } from './settings';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('mobile settings', () => {
  it('starts safely in replay with a simulator backend', () => {
    expect(initialSettings(null)).toEqual({ role: 'boss', mode: 'replay', endpoint: 'http://127.0.0.1:8000' });
  });
  it('reads employee and live settings from a native deep link', () => {
    expect(initialSettings('teamwater://chat?role=employee&mode=live&endpoint=http%3A%2F%2F192.168.1.20%3A8000')).toEqual({ role: 'employee', mode: 'live', endpoint: 'http://192.168.1.20:8000' });
  });
  it('ignores malformed links and unknown roles and modes', () => {
    expect(initialSettings('broken')).toEqual({ role: 'boss', mode: 'replay', endpoint: 'http://127.0.0.1:8000' });
    expect(initialSettings('teamwater://chat?role=relay&mode=random&endpoint=javascript%3Aalert(1)')).toEqual({ role: 'boss', mode: 'replay', endpoint: 'http://127.0.0.1:8000' });
  });
  it('requires an HTTP backend and normalizes surrounding whitespace', () => {
    expect(backendUrl(' http://192.168.1.20:8000/ ')).toBe('http://192.168.1.20:8000');
    expect(backendUrl('https://mesh.example')).toBe('https://mesh.example');
    expect(backendUrl('')).toBeNull();
    expect(backendUrl('file:///tmp')).toBeNull();
    expect(backendUrl('ws://localhost:8000')).toBeNull();
  });
  it('opens a deployed build against its configured public backend', () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://mesh.example.test/');
    expect(initialSettings(null)).toEqual({ role: 'boss', mode: 'live', endpoint: 'https://mesh.example.test' });
    expect(initialSettings('exp://app.example/--/?role=employee')).toEqual({ role: 'employee', mode: 'live', endpoint: 'https://mesh.example.test' });
  });
  it('lets a tester select replay or another server even with a deployed default', () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://mesh.example.test');
    expect(initialSettings('teamwater://chat?mode=replay&endpoint=http%3A%2F%2F192.168.1.5%3A8000')).toEqual({ role: 'boss', mode: 'replay', endpoint: 'http://192.168.1.5:8000' });
  });
  it('ignores an invalid public backend configuration', () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'javascript:alert(1)');
    expect(initialSettings(null)).toEqual({ role: 'boss', mode: 'replay', endpoint: 'http://127.0.0.1:8000' });
  });
  it('keeps the localhost defaults when the web preview flag is absent', () => {
    vi.stubGlobal('window', { location: new URL('http://localhost:8081/') });
    expect(initialSettings(null)).toEqual({ role: 'boss', mode: 'replay', endpoint: 'http://127.0.0.1:8000' });
  });
  it('starts a protected web preview live using the current site API', () => {
    vi.stubEnv('EXPO_PUBLIC_TEAM_PREVIEW', 'true');
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://old-backend.example');
    vi.stubGlobal('window', { location: new URL('https://team-preview.example/chat') });
    expect(initialSettings(null)).toEqual({ role: 'boss', mode: 'live', endpoint: 'https://team-preview.example/api' });
  });
  it('allows a preview role or replay link but ignores external endpoint overrides', () => {
    vi.stubEnv('EXPO_PUBLIC_TEAM_PREVIEW', 'true');
    vi.stubGlobal('window', { location: new URL('https://another-preview.example/') });
    expect(initialSettings('https://another-preview.example/?role=employee&endpoint=https%3A%2F%2Fexternal.example')).toEqual({ role: 'employee', mode: 'live', endpoint: 'https://another-preview.example/api' });
    expect(initialSettings('https://another-preview.example/?role=employee&mode=replay&endpoint=http%3A%2F%2Flocalhost%3A8000')).toEqual({ role: 'employee', mode: 'replay', endpoint: 'https://another-preview.example/api' });
  });
  it('keeps native defaults when no browser location exists even with the preview flag', () => {
    vi.stubEnv('EXPO_PUBLIC_TEAM_PREVIEW', 'true');
    vi.stubGlobal('window', undefined);
    expect(initialSettings(null)).toEqual({ role: 'boss', mode: 'replay', endpoint: 'http://127.0.0.1:8000' });
  });
});
