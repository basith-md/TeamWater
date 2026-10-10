import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { createMeshClient } from '@teamwater/core';
import type { MediaAsset, Mode, Role } from '@teamwater/core';
import { PhoneChat } from '@teamwater/mobile-ui';
import { backendUrl, initialSettings, isTeamPreview } from './src/settings';
import { ReceivedAudio } from './src/ReceivedAudio';
import { VoiceRecorder } from './src/VoiceRecorder';

export default function App() {
  const defaults = initialSettings(null);
  const teamPreview = isTeamPreview();
  const [role, setRole] = useState<Role>(defaults.role);
  const [mode, setMode] = useState<Mode>(defaults.mode);
  const [endpoint, setEndpoint] = useState(defaults.endpoint);
  const [endpointDraft, setEndpointDraft] = useState(defaults.endpoint);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Platform.OS !== 'web' && Keyboard.isVisible());
  const [composerFocused, setComposerFocused] = useState(false);
  const native = Platform.OS !== 'web';
  const compact = keyboardVisible || composerFocused;
  const [viewportHeight, setViewportHeight] = useState<number | null>(() => Platform.OS === 'web' && typeof window !== 'undefined' ? window.visualViewport?.height ?? null : null);
  const [error, setError] = useState<string | null>(null);
  const [client] = useState(() => createMeshClient({ mode: defaults.mode, endpoint: defaults.endpoint }));

  useEffect(() => { client.start(); return () => client.dispose(); }, [client]);
  useEffect(() => { client.setMode(mode, endpoint); }, [client, mode, endpoint]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => setViewportHeight(viewport.height);
    resize();
    viewport.addEventListener('resize', resize);
    return () => viewport.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    setKeyboardVisible(Keyboard.isVisible());
    const show = () => setKeyboardVisible(true);
    const hide = () => { setKeyboardVisible(false); setComposerFocused(false); };
    const subscriptions = [Keyboard.addListener('keyboardWillShow', show), Keyboard.addListener('keyboardDidShow', show), Keyboard.addListener('keyboardWillHide', () => setComposerFocused(false)), Keyboard.addListener('keyboardDidHide', hide)];
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, []);
  useEffect(() => {
    let mounted = true;
    function configure(url: string | null) {
      if (!url || !mounted) return;
      // A normal Expo/browser launch URL carries no phone settings. Applying
      // its defaults later would overwrite a role or mode the user just chose.
      if (!/[?&](role|mode|endpoint)=/.test(url)) return;
      const next = initialSettings(url);
      setRole(next.role); setMode(next.mode); setEndpoint(next.endpoint); setEndpointDraft(next.endpoint);
    }
    Linking.getInitialURL().then(configure).catch(() => {});
    const subscription = Linking.addEventListener('url', event => configure(event.url));
    return () => { mounted = false; subscription.remove(); };
  }, []);

  function applyEndpoint() {
    const next = backendUrl(endpointDraft);
    if (!next) { setError('Enter an http:// or https:// backend URL.'); return; }
    setEndpoint(next); setEndpointDraft(next); setError(null);
  }

  return <KeyboardAvoidingView style={[styles.app, compact && styles.typingApp, viewportHeight !== null && { height: viewportHeight, maxHeight: viewportHeight }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <StatusBar barStyle="light-content" backgroundColor="#232825"/>
    <View style={[styles.top, native && styles.nativeTop, compact && styles.typingTop]}>
      <View><Text style={[styles.brand, compact && styles.typingBrand]}>TEAMWATER<Text style={styles.brandDot}>.</Text></Text>{!compact && <Text style={styles.tagline}>A LITTLE SIGNAL GOES A LONG WAY</Text>}</View>
      <View style={styles.topActions}>
        {compact && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss keyboard" onPress={() => { Keyboard.dismiss(); setComposerFocused(false); }} style={styles.settingsButton}><Text style={styles.settingsText}>Done</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Open connection settings" onPress={() => setSettingsOpen(!settingsOpen)} style={styles.settingsButton}><Text style={styles.settingsText}>{settingsOpen ? 'Close' : 'Settings'}</Text></Pressable>
      </View>
    </View>
    {!compact && <View style={styles.roleRow}><Pressable accessibilityRole="button" accessibilityLabel="Use boss phone" onPress={() => setRole('boss')} style={[styles.roleButton, role === 'boss' && styles.activeRole]}><Text style={[styles.roleText, role === 'boss' && styles.activeRoleText]}>Boss / node0</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Use employee phone" onPress={() => setRole('employee')} style={[styles.roleButton, role === 'employee' && styles.activeRole]}><Text style={[styles.roleText, role === 'employee' && styles.activeRoleText]}>Playa / node4</Text></Pressable></View>}
    {settingsOpen && <View style={styles.settings}>
      <Text style={styles.settingLabel}>CONNECTION</Text>
      <View style={styles.modeButtons}>{(['replay', 'live'] as Mode[]).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'replay' ? 'Use demo replay' : 'Use live backend'} onPress={() => setMode(value)} style={[styles.modeButton, mode === value && styles.activeMode]}><Text style={[styles.modeButtonText, mode === value && styles.activeModeText]}>{value === 'replay' ? 'Sample replay' : 'Live simulation'}</Text></Pressable>)}</View>
      {teamPreview ? <Text style={styles.help}>Connected through this protected team preview.</Text> : <>
        <Text accessibilityLabel="Backend help" style={styles.help}>Use 127.0.0.1 for the iOS simulator. On a real phone, enter your computer’s LAN address.</Text>
        <View style={styles.endpointRow}><TextInput accessibilityLabel="Backend URL" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={endpointDraft} onChangeText={setEndpointDraft} style={styles.endpoint}/><Pressable accessibilityRole="button" accessibilityLabel="Apply backend URL" onPress={applyEndpoint} style={styles.apply}><Text style={styles.applyText}>Apply</Text></Pressable></View>
      </>}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Text style={styles.help}>Live simulation runs your messages through the mesh. Sample replay shows prerecorded examples.</Text>
    </View>}
    <PhoneChat key={role} client={client} role={role} compact={compact} onComposerFocusChange={focused => { setComposerFocused(focused); if (focused) setSettingsOpen(false); }} pickMedia={pickMedia} renderAudio={uri => <ReceivedAudio key={uri} uri={uri}/>} renderVoiceRecorder={props => <VoiceRecorder {...props}/>}/>
  </KeyboardAvoidingView>;
}

async function pickMedia(kind: 'image' | 'voice'): Promise<MediaAsset | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: kind === 'image' ? 'image/*' : 'audio/*', multiple: false, copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.name, type: asset.mimeType || (kind === 'image' ? 'image/jpeg' : 'audio/mp4'), ...(asset.file ? { file: asset.file } : {}) };
}

const styles = StyleSheet.create({
  nativeTop: { paddingTop: 8, paddingBottom: 8 }, typingTop: { paddingTop: 4, paddingBottom: 4 }, typingBrand: { fontSize: 14 }, typingApp: { paddingBottom: 0 }, topActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  app: { flex: 1, backgroundColor: '#232825', paddingTop: Platform.OS === 'web' ? 0 : Platform.OS === 'ios' ? 54 : 32, paddingBottom: Platform.OS === 'ios' ? 24 : 0 }, top: { padding: 19, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: '#fffaf1', fontSize: 19, fontWeight: '800', letterSpacing: 1.5 }, brandDot: { color: '#e77c40' }, tagline: { color: '#939b8f', fontSize: 7, letterSpacing: 1.1, marginTop: 4 }, settingsButton: { padding: 9, borderWidth: 1, borderColor: '#485045', borderRadius: 6 }, settingsText: { color: '#bfc5b7', fontSize: 10 }, roleRow: { flexDirection: 'row', paddingHorizontal: 19, paddingBottom: 16, gap: 6 }, roleButton: { flex: 1, padding: 10, borderRadius: 7, backgroundColor: '#30392e', alignItems: 'center' }, activeRole: { backgroundColor: '#e87b40' }, roleText: { fontSize: 11, color: '#bdc6b7', fontWeight: '600' }, activeRoleText: { color: '#fff' },
  settings: { padding: 16, backgroundColor: '#eae5d9', gap: 10 }, settingLabel: { color: '#8b806d', fontSize: 9, letterSpacing: 1 }, modeButtons: { flexDirection: 'row', gap: 6 }, modeButton: { flex: 1, padding: 9, borderRadius: 6, backgroundColor: '#ded7c8', alignItems: 'center' }, activeMode: { backgroundColor: '#46503e' }, modeButtonText: { fontSize: 11, color: '#77725f' }, activeModeText: { color: '#fff' }, help: { color: '#8a816d', fontSize: 10, lineHeight: 15 }, endpointRow: { flexDirection: 'row', gap: 6 }, endpoint: { flex: 1, backgroundColor: '#faf7f1', borderRadius: 6, padding: 10, fontSize: 11, color: '#343e2f' }, apply: { backgroundColor: '#d47a43', padding: 11, borderRadius: 6 }, applyText: { color: '#fff', fontSize: 11 }, error: { fontSize: 11, color: '#a2472e' },
});
