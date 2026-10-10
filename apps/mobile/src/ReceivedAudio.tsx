import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

export function ReceivedAudio({ uri }: { uri: string }) {
  const player = useAudioPlayer({ uri }, { downloadFirst: true, updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError || status.error;

  async function toggle() {
    setActionError(null);
    try {
      if (status.playing) player.pause();
      else {
        if (status.didJustFinish) await player.seekTo(0);
        player.play();
      }
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'This device could not play the received audio.'); }
  }

  return <View style={styles.audio}>
    <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause received audio' : 'Play received audio'} disabled={!status.isLoaded || !!error} onPress={toggle} style={[styles.play, (!status.isLoaded || !!error) && styles.disabled]}><Text style={styles.playText}>{status.playing ? 'Ⅱ' : '▶'}</Text></Pressable><Text style={styles.time}>{clock(status.currentTime)} / {clock(status.duration)}</Text></View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>Playback unavailable · {error}</Text> : !status.isLoaded ? <Text style={styles.note}>Loading received audio…</Text> : <Text style={styles.note}>Verified audio · Ogg Opus support depends on your device</Text>}
  </View>;
}

function clock(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  audio: { backgroundColor: '#e7e2d5', borderRadius: 8, padding: 10, marginBottom: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, play: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#d57d46', alignItems: 'center', justifyContent: 'center' }, playText: { color: '#fff', fontSize: 13 }, disabled: { opacity: .4 }, time: { color: '#686d5b', fontSize: 11 }, note: { color: '#888171', fontSize: 8, lineHeight: 13, marginTop: 6 }, error: { color: '#a54d34', fontSize: 9, lineHeight: 14, marginTop: 6 },
});
