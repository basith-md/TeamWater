import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { deliveryLabel, roleNodes } from '@teamwater/core';
import type { MediaAsset, MeshClient, MeshMessage, Role } from '@teamwater/core';
export interface VoiceRecorderProps {
  onSend: (asset: MediaAsset) => Promise<void>;
  disabled: boolean;
}
export interface PhoneChatProps {
  client: MeshClient;
  role: Role;
  embedded?: boolean;
  compact?: boolean;
  onComposerFocusChange?: (focused: boolean) => void;
  pickMedia?: (kind: 'image' | 'voice') => Promise<MediaAsset | null>;
  renderAudio?: (uri: string) => React.ReactNode;
  renderVoiceRecorder?: (props: VoiceRecorderProps) => React.ReactNode;
}
const identities = {
  boss: { name: 'Alex', title: 'Team lead', location: 'San Francisco, CA', initial: 'A', contact: 'Jordan', contactPlace: 'Burning Man · Black Rock City' },
  employee: { name: 'Jordan', title: 'Engineer', location: 'Burning Man · Black Rock City', initial: 'J', contact: 'Alex', contactPlace: 'San Francisco, CA' },
};

export function PhoneChat({ client, role, embedded = false, compact = false, onComposerFocusChange, pickMedia, renderAudio, renderVoiceRecorder }: PhoneChatProps) {
  const { fontScale } = useWindowDimensions();
  const inputScale = Number.isFinite(fontScale) && fontScale > 1 ? fontScale : 1;
  const state = useSyncExternalStore(client.subscribe.bind(client), client.getSnapshot.bind(client), client.getSnapshot.bind(client));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionNumber = useRef(0);
  const session = useMemo(() => ({ key: ++sessionNumber.current }), [client, role, state.mode, state.endpoint]);
  const sessionRef = useRef(session); sessionRef.current = session;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setBusy(false); setError(null); }, [session]);
  const draftRef = useRef(draft); draftRef.current = draft;
  const list = useRef<ScrollView>(null);
  const identity = identities[role];
  const { src, dst } = roleNodes(role);
  const messages = Object.values(state.messages).filter(message => (message.src === src && message.dst === dst) || (message.src === dst && message.dst === src)).sort((a, b) => {
    if (a.createdAt === null) return b.createdAt === null ? a.id.localeCompare(b.id) : 1;
    if (b.createdAt === null) return -1;
    return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  });

  async function send() {
    const sentDraft = draft;
    if (busy || !sentDraft.trim()) return;
    setBusy(true); setError(null);
    try {
      await client.sendText(src, dst, sentDraft.trim());
      if (mounted.current && sessionRef.current === session && draftRef.current === sentDraft) setDraft('');
    } catch (failure) { if (mounted.current && sessionRef.current === session) setError(failure instanceof Error ? failure.message : 'Message could not be sent. Try again.'); }
    finally { if (mounted.current && sessionRef.current === session) setBusy(false); }
  }

  async function attach(kind: 'image' | 'voice') {
    if (busy) return;
    setError(null);
    if (!pickMedia) { setError('File selection is unavailable in this view. Open the Expo app to attach an image or audio file.'); return; }
    setBusy(true);
    try {
      const asset = await pickMedia(kind);
      if (asset && mounted.current && sessionRef.current === session) await client.sendMedia(src, dst, kind, asset);
    } catch (failure) { if (mounted.current && sessionRef.current === session) setError(failure instanceof Error ? failure.message : 'Attachment could not be sent. Try again.'); }
    finally { if (mounted.current && sessionRef.current === session) setBusy(false); }
  }

  async function sendRecordedVoice(asset: MediaAsset) {
    if (!mounted.current || sessionRef.current !== session || state.mode !== 'live') throw new Error('Connection changed. Record a new voice message.');
    if (busy) throw new Error('Another message is sending. Please try again.');
    setBusy(true); setError(null);
    try {
      await client.sendMedia(src, dst, 'voice', asset);
      if (!mounted.current || sessionRef.current !== session) throw new Error('Connection changed; voice send cancelled.');
    } catch (failure) {
      if (mounted.current && sessionRef.current === session) setError(failure instanceof Error ? failure.message : 'Voice send failed. Try again.');
      throw failure;
    } finally { if (mounted.current && sessionRef.current === session) setBusy(false); }
  }

  return <View style={[styles.phone, embedded && styles.embedded]}>
    {!compact && <View style={styles.identity}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{identity.initial}</Text></View>
      <View style={styles.identityCopy}><Text style={styles.person}>{identity.name}<Text style={styles.role}> / {identity.title}</Text></Text><Text style={styles.location}>{identity.location}</Text></View>
      <Text style={styles.node}>{src.toUpperCase()}</Text>
    </View>}
    <View style={[styles.contactRow, compact && styles.compactContactRow]}><View><Text style={[styles.contact, compact && styles.compactContact]}>{identity.contact}</Text>{!compact && <Text style={styles.contactPlace}>{identity.contactPlace}</Text>}</View><View style={styles.meshBadge}><View style={[styles.dot, state.connection !== 'connected' && styles.offlineDot]} /><Text style={styles.meshBadgeText}>{compact ? `${state.mode === 'live' ? 'LIVE' : 'SAMPLE'} · ${state.connection === 'connected' ? 'Connected' : state.connection === 'connecting' ? 'Connecting…' : 'Offline'}` : 'MESH'}</Text></View></View>
    {!compact && <View style={styles.modeRow}><Text style={styles.modeLabel}>{state.mode === 'replay' ? 'Sample replay · example messages' : 'Live simulation'}</Text><Text style={styles.connection}>{state.connection === 'connected' ? 'Connected' : state.connection === 'connecting' ? 'Connecting…' : 'Offline'}</Text></View>}
    <ScrollView ref={list} style={styles.messages} contentContainerStyle={[styles.messageContent, compact && styles.compactMessageContent]} onLayout={() => list.current?.scrollToEnd({ animated: false })} onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
      {!compact && <View style={styles.dayRow}><View style={styles.dayLine}/><Text style={styles.day}>OFF THE GRID. STILL IN SYNC.</Text><View style={styles.dayLine}/></View>}
      {messages.length === 0 && <View style={[styles.empty, compact && styles.compactEmpty]}><Text style={styles.emptyTitle}>A signal through the dust.</Text><Text style={styles.emptyText}>{role === 'boss' ? 'Jordan is at Burning Man. Send a message to ask for help with the code.' : 'You’re connected to Alex through the mesh. Send a reply when you’re ready.'}</Text>{role === 'boss' && <Pressable accessibilityRole="button" accessibilityLabel="Use conversation starter" style={styles.starter} onPress={() => setDraft('Hey Jordan — I know you’re at Burning Man, but could you help fix the code when you get a signal?')}><Text style={styles.starterText}>Use conversation starter ↗</Text></Pressable>}</View>}
      {messages.map(message => <MessageBubble key={message.id} message={message} outgoing={message.src === src} mode={state.mode} sender={message.src === src ? identity.name : identity.contact} renderAudio={renderAudio} />)}
    </ScrollView>
    {(error || state.error) && <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error || state.error}</Text></View>}
    <View style={[styles.composeArea, compact && styles.compactComposeArea]}>
      {state.mode === 'live' && renderVoiceRecorder && <View key={session.key}>{renderVoiceRecorder({ onSend: sendRecordedVoice, disabled: busy })}</View>}
      <View style={styles.compose}><TextInput accessibilityLabel="Message input" placeholder={`Message ${identity.contact}…`} placeholderTextColor="#8d8982" value={draft} onChangeText={setDraft} onFocus={() => { onComposerFocusChange?.(true); list.current?.scrollToEnd({ animated: false }); }} onBlur={() => onComposerFocusChange?.(false)} multiline numberOfLines={2} textAlignVertical="top" maxLength={8000} scrollEnabled style={[styles.input, { minHeight: Math.ceil(40 * inputScale + 16), maxHeight: Math.ceil(80 * inputScale + 24) }]}/><Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={busy || !draft.trim()} onPress={send} style={[styles.send, (busy || !draft.trim()) && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" size="small"/> : <Text style={styles.sendArrow}>↑</Text>}</Pressable></View>
      <View style={styles.composeFooter}><View style={styles.attachments}><Pressable accessibilityRole="button" accessibilityLabel="Attach image" disabled={busy} onPress={() => attach('image')} style={styles.attachment}><Text style={styles.attachmentText}>▧ Image</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Attach voice file" disabled={busy} onPress={() => attach('voice')} style={styles.attachment}><Text style={styles.attachmentText}>≋ Audio file</Text></Pressable></View>{!compact && <Text accessibilityLabel={state.mode === 'replay' ? 'Voice recording requires Live mode' : renderVoiceRecorder ? undefined : 'Voice recording unavailable in this view'} style={styles.composeHint}>{state.mode === 'replay' ? 'VOICE: LIVE ONLY' : renderVoiceRecorder ? 'STORE · FORWARD' : 'RECORDER UNAVAILABLE'}</Text>}</View>
    </View>
  </View>;
}

function MessageBubble({ message, outgoing, mode, sender, renderAudio }: { message: MeshMessage; outgoing: boolean; mode: 'live' | 'replay'; sender: string; renderAudio?: PhoneChatProps['renderAudio'] }) {
  const chunks = Math.max(0, message.totalChunks);
  const received = Math.max(0, Math.min(chunks, message.received));
  const progress = chunks > 0 ? received / chunks : 0;
  const verified = message.integrity === 'verified';
  const contentReady = outgoing || (mode === 'replay' ? received === chunks && chunks > 0 && verified : verified || received > 0);
  const verifiedMedia = mode === 'live' && verified && !!message.mediaUrl;
  const statusLabel = outgoing ? deliveryLabel(message) : verified ? 'Receiver verified' : message.status === 'failed' ? 'Transfer failed' : message.status === 'cancelled' ? 'Transfer cancelled' : chunks > 0 && received === chunks ? 'Received · unverified' : 'Receiving…';
  return <View style={[styles.messageRow, outgoing && styles.outgoingRow]}>
    <Text style={styles.sender}>{outgoing ? 'YOU' : sender.toUpperCase()} · {message.src.toUpperCase()}</Text>
    <View style={[styles.bubble, outgoing && styles.outgoingBubble]}>
      {message.kind !== 'text' && <Text style={[styles.mediaType, outgoing && styles.lightText]}>{message.kind === 'image' ? '▧ IMAGE ATTACHMENT' : '≋ AUDIO ATTACHMENT'}</Text>}
      {contentReady && mode === 'replay' && message.kind === 'image' && message.mediaUrl && <Image source={{ uri: message.mediaUrl }} style={styles.mediaImage} accessibilityLabel="Sample replay image"/>}
      {verifiedMedia && message.kind === 'image' && <Image source={{ uri: message.mediaUrl }} style={styles.mediaImage} accessibilityLabel="Verified received image"/>}
      {verifiedMedia && message.kind === 'voice' && renderAudio && renderAudio(message.mediaUrl!)}
      <Text style={[styles.messageText, outgoing && styles.lightText]}>{!outgoing && mode === 'live' && verified && message.kind === 'text' && message.text === undefined ? 'Loading verified text…' : contentReady ? message.text ?? (message.preview || 'No preview available') : message.status === 'failed' ? 'Transfer interrupted · content unavailable' : `Receiving ${message.kind}…`}</Text>
      {mode === 'live' && !verified && <Text style={[styles.disclosure, outgoing && styles.outgoingDisclosure]}>Unverified preview · may be truncated</Text>}
      {message.kind !== 'text' && (!verifiedMedia || message.kind === 'voice' && !renderAudio) && <Text style={[styles.disclosure, outgoing && styles.outgoingDisclosure]}>{mode === 'replay' ? 'Sample replay media · illustrative content' : verifiedMedia ? 'Playback unavailable in this view · open a supported audio player' : `${message.kind === 'voice' ? 'Playback' : 'Image viewing'} unavailable · ${verified ? 'verified receiver content URL unavailable' : 'awaiting verified receiver content'}`}</Text>}
    </View>
    <View style={styles.deliveryRow}><Text style={styles.delivery}>{statusLabel}</Text><Text style={styles.chunks}>{received}/{chunks} chunks</Text></View>
    {chunks > 0 && <View style={styles.progressTrack} accessibilityLabel={`${received} of ${chunks} chunks received`}><View style={[styles.progressFill, { width: `${progress * 100}%` }, message.status === 'failed' && styles.failedFill]}/></View>}
  </View>;
}

const styles = StyleSheet.create({
  phone: { flex: 1, flexShrink: 1, minHeight: 0, backgroundColor: '#faf8f3', overflow: 'hidden' }, embedded: { minHeight: 620 },
  compactContactRow: { paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderColor: '#e9e5dc' }, compactContact: { fontSize: 16 }, compactMessageContent: { padding: 10, gap: 12 }, compactEmpty: { paddingVertical: 10 }, compactComposeArea: { paddingHorizontal: 10, paddingVertical: 8 },
  identity: { padding: 19, backgroundColor: '#232825', flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e96f34', alignItems: 'center', justifyContent: 'center' }, avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' }, identityCopy: { flex: 1 }, person: { color: '#fff', fontSize: 14, fontWeight: '700' }, role: { fontSize: 10, fontWeight: '400', color: '#bbbfb8' }, location: { color: '#b6bbb3', fontSize: 10, marginTop: 5 }, node: { color: '#d4b99d', fontSize: 9, letterSpacing: 1 },
  contactRow: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, contact: { fontSize: 21, fontWeight: '700', color: '#252a26', letterSpacing: -.5 }, contactPlace: { fontSize: 10, color: '#8a867c', marginTop: 4 }, meshBadge: { backgroundColor: '#eeede5', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5 }, meshBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: '#5c6658' }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#659371' }, offlineDot: { backgroundColor: '#be7853' },
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 20, paddingBottom: 13, borderBottomWidth: 1, borderColor: '#e9e5dc' }, modeLabel: { fontSize: 9, color: '#a36440' }, connection: { fontSize: 9, color: '#7a7e70' }, messages: { flex: 1, minHeight: 0 }, messageContent: { padding: 20, gap: 19, flexGrow: 1 }, dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }, dayLine: { height: 1, backgroundColor: '#e7e2d8', flex: 1 }, day: { color: '#a7a093', fontSize: 7, letterSpacing: 1.2 },
  empty: { paddingVertical: 32 }, emptyTitle: { color: '#494c42', fontSize: 20, fontWeight: '600', lineHeight: 26 }, emptyText: { fontSize: 12, lineHeight: 20, color: '#888477', marginTop: 10 }, starter: { marginTop: 20, borderWidth: 1, borderColor: '#e4c7b6', borderRadius: 8, padding: 12 }, starterText: { color: '#ae5f38', fontSize: 11, fontWeight: '600' },
  messageRow: { alignSelf: 'flex-start', alignItems: 'flex-start', width: '90%', gap: 6 }, outgoingRow: { alignSelf: 'flex-end', alignItems: 'flex-end' }, sender: { fontSize: 8, color: '#969184', letterSpacing: .8 }, bubble: { backgroundColor: '#efece3', borderRadius: 13, borderTopLeftRadius: 3, padding: 13, width: '100%' }, outgoingBubble: { backgroundColor: '#303831', borderTopLeftRadius: 13, borderTopRightRadius: 3 }, messageText: { color: '#363e35', fontSize: 13, lineHeight: 20 }, lightText: { color: '#f8f6ef' }, disclosure: { fontSize: 8, lineHeight: 13, color: '#868171', marginTop: 8 }, outgoingDisclosure: { color: '#aeb5a6' }, mediaType: { fontSize: 9, letterSpacing: 1, color: '#767b6e', marginBottom: 8 }, mediaImage: { height: 140, width: '100%', borderRadius: 6, marginBottom: 8 }, deliveryRow: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', gap: 8 }, delivery: { fontSize: 8, color: '#8a836f', flex: 1 }, chunks: { fontSize: 8, color: '#a09582' }, progressTrack: { height: 2, width: '100%', borderRadius: 1, backgroundColor: '#e9e3d7' }, progressFill: { height: 2, backgroundColor: '#d8824e', borderRadius: 1 }, failedFill: { backgroundColor: '#b85441' },
  composeArea: { flexShrink: 0, backgroundColor: '#f5f2ea', padding: 14, borderTopWidth: 1, borderColor: '#e7e1d7' }, compose: { flexShrink: 0, borderWidth: 1, borderColor: '#ded8cc', backgroundColor: '#fffcf7', borderRadius: 12, padding: 7, flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { flex: 1, minWidth: 0, minHeight: 56, maxHeight: 104, fontSize: 13, lineHeight: 20, padding: 8, color: '#30372e' }, send: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e3773e', alignItems: 'center', justifyContent: 'center' }, sendArrow: { color: '#fff', fontSize: 20, lineHeight: 24 }, disabled: { opacity: .45 }, composeFooter: { marginTop: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, attachments: { flexDirection: 'row', gap: 10 }, attachment: { paddingVertical: 5 }, attachmentText: { fontSize: 9, color: '#888371' }, composeHint: { fontSize: 7, color: '#a89d89', letterSpacing: .8 }, error: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fceae0' }, errorText: { color: '#a74c30', fontSize: 11, lineHeight: 16 },
});
