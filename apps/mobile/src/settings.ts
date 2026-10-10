import type { Mode, Role } from '@teamwater/core';
export interface MobileSettings { role: Role; mode: Mode; endpoint: string }
export function initialSettings(link: string | null): MobileSettings {
  const defaults: MobileSettings = { role: 'boss', mode: 'replay', endpoint: 'http://127.0.0.1:8000' };
  if (!link) return defaults;
  try {
    const params = new URL(link).searchParams;
    return { role: params.get('role') === 'employee' ? 'employee' : 'boss', mode: params.get('mode') === 'live' ? 'live' : 'replay', endpoint: backendUrl(params.get('endpoint') || '') || defaults.endpoint };
  } catch { return defaults; }
}
export function backendUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}
