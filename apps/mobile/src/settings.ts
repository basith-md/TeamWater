import type { Mode, Role } from '@teamwater/core';
import { Platform } from 'react-native';
export interface MobileSettings { role: Role; mode: Mode; endpoint: string }
export function isTeamPreview(): boolean {
  return process.env.EXPO_PUBLIC_TEAM_PREVIEW === 'true' && Platform.OS === 'web' && typeof window !== 'undefined' && ['https:', 'http:'].includes(window.location.protocol);
}
export function initialSettings(link: string | null): MobileSettings {
  const preview = isTeamPreview();
  const deployedEndpoint = preview ? `${window.location.origin}/api` : backendUrl(process.env.EXPO_PUBLIC_BACKEND_URL || '');
  const defaults: MobileSettings = { role: 'boss', mode: deployedEndpoint ? 'live' : 'replay', endpoint: deployedEndpoint || 'http://127.0.0.1:8000' };
  if (!link) return defaults;
  try {
    const params = new URL(link).searchParams;
    const mode = params.get('mode');
    return { role: params.get('role') === 'employee' ? 'employee' : 'boss', mode: mode === 'live' || mode === 'replay' ? mode : defaults.mode, endpoint: preview ? defaults.endpoint : backendUrl(params.get('endpoint') || '') || defaults.endpoint };
  } catch { return defaults; }
}
export function backendUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}
