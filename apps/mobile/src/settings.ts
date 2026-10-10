import type { Mode, Role } from '@teamwater/core';
export interface MobileSettings { role: Role; mode: Mode; endpoint: string }
export function initialSettings(link: string | null): MobileSettings {
  const deployedEndpoint = backendUrl(process.env.EXPO_PUBLIC_BACKEND_URL || '');
  const defaults: MobileSettings = { role: 'boss', mode: deployedEndpoint ? 'live' : 'replay', endpoint: deployedEndpoint || 'http://127.0.0.1:8000' };
  if (!link) return defaults;
  try {
    const params = new URL(link).searchParams;
    const mode = params.get('mode');
    return { role: params.get('role') === 'employee' ? 'employee' : 'boss', mode: mode === 'live' || mode === 'replay' ? mode : defaults.mode, endpoint: backendUrl(params.get('endpoint') || '') || defaults.endpoint };
  } catch { return defaults; }
}
export function backendUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}
