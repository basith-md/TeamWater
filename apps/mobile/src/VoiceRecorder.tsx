import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from 'expo-audio';
import type { RecordingStatus } from 'expo-audio';
import type { MediaAsset } from '@teamwater/core';
import type { VoiceRecorderProps } from '@teamwater/mobile-ui';

type Phase = 'idle' | 'preparing' | 'recording' | 'stopping' | 'preview' | 'sending';
const recordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1 };
const playbackMode = { allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false };
// Native audio mode is global. Finish old setup/cleanup before a replacement
// phone session enables its microphone, including delayed permission prompts.
let recordingWork: Promise<void> = Promise.resolve();
function serializeRecording(work: () => Promise<void>): Promise<void> {
  const next = recordingWork.then(work, work);
  recordingWork = next.catch(() => {});
  return next;
}

export function VoiceRecorder({ onSend, disabled }: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<MediaAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const epoch = useRef(0);
  const mounted = useRef(true);
  const prepared = useRef(false);
  const permissionPending = useRef<number | null>(null);
  const timers = useRef<{ ticker: ReturnType<typeof setInterval> | null; limit: ReturnType<typeof setTimeout> | null }>({ ticker: null, limit: null });
  const completion = useRef<(status: RecordingStatus) => void>(() => {});
  const recorder = useAudioRecorder(recordingOptions, status => completion.current(status));

  function transition(next: Phase) { phaseRef.current = next; if (mounted.current) setPhase(next); }
  function active(token: number) { return mounted.current && token === epoch.current; }
  function clearTimers() { if (timers.current.ticker) clearInterval(timers.current.ticker); if (timers.current.limit) clearTimeout(timers.current.limit); timers.current = { ticker: null, limit: null }; }
  async function restorePlayback() { await setAudioModeAsync(playbackMode); }

  async function finish(token: number, uri: string | null) {
    if (!active(token)) return;
    clearTimers(); transition('stopping');
    try {
      await restorePlayback();
      if (!active(token)) return;
      if (!uri) throw new Error('No recorded audio file is available. Please record again.');
      let asset: MediaAsset = { uri, name: 'voice.m4a', type: 'audio/mp4' };
      if (uri.startsWith('blob:')) {
        const file = await (await fetch(uri)).blob();
        if (!active(token)) return;
        asset = { uri, file, name: 'voice.webm', type: file.type || 'audio/webm' };
      }
      setClip(asset); transition('preview');
    } catch (issue) {
      if (active(token)) { setError(issue instanceof Error ? issue.message : 'Could not prepare the voice preview.'); transition('idle'); }
    }
  }

  async function stop(token = epoch.current) {
    if (!active(token) || phaseRef.current !== 'recording') return;
    clearTimers(); transition('stopping');
    await serializeRecording(async () => {
      try { await recorder.stop(); prepared.current = false; await finish(token, recorder.uri); }
      catch (issue) {
        await restorePlayback().catch(() => {});
        if (active(token)) { setError(issue instanceof Error ? issue.message : 'Could not stop the recording.'); transition('idle'); }
      }
    });
  }

  completion.current = status => {
    if (phaseRef.current !== 'recording') return;
    if (status.hasError) {
      const token = epoch.current;
      clearTimers(); prepared.current = false; transition('stopping');
      void serializeRecording(async () => {
        await restorePlayback().catch(() => {});
        if (active(token)) { setError(status.error || 'Recording was interrupted. Please record again.'); transition('idle'); }
      });
    } else if (status.isFinished && !recorder.isRecording) {
      const token = epoch.current;
      clearTimers(); prepared.current = false; transition('stopping');
      void serializeRecording(() => finish(token, status.url || recorder.uri));
    }
  };

  async function cancel(update = true) {
    const previous = phaseRef.current;
    epoch.current++; clearTimers(); transition('idle');
    if (update && mounted.current) { setClip(null); setError(null); setElapsed(0); }
    await serializeRecording(async () => {
      try { if (previous !== 'stopping' && (prepared.current || recorder.isRecording)) await recorder.stop(); }
      catch { /* The native recorder can already be stopped by an interruption. */ }
      finally { prepared.current = false; await restorePlayback().catch(() => {}); }
    });
  }

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      // iOS permission dialogs temporarily report inactive without backgrounding.
      if (state === 'inactive' && permissionPending.current !== null) return;
      if (state !== 'active') void cancel();
    });
    return () => { mounted.current = false; subscription.remove(); void cancel(false); };
  }, [recorder]);

  useEffect(() => {
    if (disabled && (phaseRef.current === 'recording' || phaseRef.current === 'preparing')) void cancel();
  }, [disabled]);

  async function start() {
    if (disabled || phaseRef.current !== 'idle') return;
    const token = ++epoch.current;
    transition('preparing'); setError(null); setElapsed(0);
    await serializeRecording(async () => {
    if (!active(token)) return;
    try {
      permissionPending.current = token;
      let permission;
      try { permission = await requestRecordingPermissionsAsync(); }
      finally { if (permissionPending.current === token) permissionPending.current = null; }
      if (!active(token)) return;
      if (!permission.granted) throw new Error('Microphone permission is required to record a voice message. Enable it in device Settings.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      if (!active(token)) { await restorePlayback(); return; }
      await recorder.prepareToRecordAsync(); prepared.current = true;
      if (!active(token)) { await recorder.stop().catch(() => {}); prepared.current = false; await restorePlayback(); return; }
      transition('recording');
      recorder.record({ forDuration: 5 });
      const startedAt = Date.now();
      timers.current.ticker = setInterval(() => { if (active(token)) setElapsed(Math.min(5, (Date.now() - startedAt) / 1000)); }, 100);
      timers.current.limit = setTimeout(() => { if (active(token)) { setElapsed(5); void stop(token); } }, 5000);
    } catch (issue) {
      await restorePlayback().catch(() => {});
      if (active(token)) { setError(issue instanceof Error ? issue.message : 'Could not start the microphone.'); transition('idle'); }
    }
    });
  }

  async function send() {
    if (!clip || disabled || phaseRef.current !== 'preview') return;
    const token = epoch.current; transition('sending'); setError(null);
    try { await onSend(clip); if (active(token)) { setClip(null); setElapsed(0); transition('idle'); } }
    catch (issue) { if (active(token)) { setError(issue instanceof Error ? issue.message : 'Voice send failed. Your clip is ready to retry.'); transition('preview'); } }
  }

  return <View style={styles.voice}>
    {phase === 'idle' && <Pressable accessibilityRole="button" accessibilityLabel="Record voice" disabled={disabled} onPress={start} style={[styles.record, disabled && styles.disabled]}><Text style={styles.recordText}>● Record voice</Text><Text style={styles.limit}>5 seconds max</Text></Pressable>}
    {phase === 'preparing' && <Text style={styles.status}>Opening microphone…</Text>}
    {phase === 'recording' && <View style={styles.row}><View style={styles.recordingDot}/><Text style={styles.duration}>{elapsed.toFixed(1)} / 5.0 seconds</Text><Pressable accessibilityRole="button" accessibilityLabel="Stop recording" onPress={() => { void stop(); }} style={styles.stop}><Text style={styles.stopText}>■ Stop</Text></Pressable></View>}
    {phase === 'stopping' && <Text style={styles.status}>Preparing your voice message…</Text>}
    {clip && (phase === 'preview' || phase === 'sending') && <View><VoicePreview key={clip.uri} uri={clip.uri}/><View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel="Send voice" disabled={disabled || phase === 'sending'} onPress={send} style={[styles.send, (disabled || phase === 'sending') && styles.disabled]}><Text style={styles.sendText}>{phase === 'sending' ? 'Sending voice…' : 'Send voice ↑'}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Discard voice" disabled={phase === 'sending'} onPress={() => { void cancel(); }} style={styles.discard}><Text style={styles.discardText}>Discard</Text></Pressable></View></View>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

function VoicePreview({ uri }: { uri: string }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    try {
      if (status.playing) player.pause();
      else { if (status.didJustFinish) await player.seekTo(0); player.play(); }
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Preview playback unavailable.'); }
  }
  return <View style={styles.preview}><Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause voice preview' : 'Play voice preview'} disabled={!status.isLoaded || !!status.error} onPress={toggle} style={styles.previewPlay}><Text style={styles.previewText}>{status.playing ? 'Ⅱ Pause' : '▶ Play preview'}</Text></Pressable><Text style={styles.previewHint}>Your recording · {Math.max(0, status.duration || 0).toFixed(1)}s</Text>{(error || status.error) && <Text accessibilityRole="alert" style={styles.error}>Preview playback unavailable · {error || status.error}</Text>}</View>;
}

const styles = StyleSheet.create({
  voice: { marginBottom: 10 }, record: { backgroundColor: '#e4773d', borderRadius: 9, paddingVertical: 11, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, recordText: { color: '#fff', fontSize: 12, fontWeight: '700' }, limit: { color: '#ffe1cb', fontSize: 9 }, disabled: { opacity: .45 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#cc543b' }, duration: { flex: 1, fontSize: 12, color: '#766b57' }, stop: { backgroundColor: '#343d31', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 }, stopText: { color: '#fff', fontSize: 11 }, status: { color: '#8b7c64', fontSize: 11, paddingVertical: 10 }, preview: { backgroundColor: '#eae4d7', borderRadius: 8, padding: 9, marginBottom: 8, gap: 5 }, previewPlay: { padding: 4 }, previewText: { color: '#697057', fontSize: 11, fontWeight: '600' }, previewHint: { color: '#9c9078', fontSize: 8 }, send: { flex: 1, padding: 11, backgroundColor: '#d97941', borderRadius: 7, alignItems: 'center' }, sendText: { color: '#fff', fontSize: 12, fontWeight: '700' }, discard: { padding: 10 }, discardText: { color: '#897963', fontSize: 10 }, error: { color: '#a7462c', fontSize: 10, lineHeight: 15, marginTop: 8 },
});
