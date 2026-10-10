import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AudioStatus } from 'expo-audio';
import { ReceivedAudio } from './ReceivedAudio';

const audio = vi.hoisted(() => ({ status: {} as AudioStatus, playError: null as string | null }));
vi.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: () => { if (audio.playError) throw new Error(audio.playError); }, pause: () => {}, seekTo: async () => {} }),
  useAudioPlayerStatus: () => audio.status,
}));
beforeEach(() => {
  audio.playError = null;
  audio.status = { id: 'audio1', currentTime: 0, playbackState: 'ready', timeControlStatus: 'paused', reasonForWaitingToPlay: '', mute: false, duration: 5, playing: false, loop: false, didJustFinish: false, isBuffering: false, isLoaded: true, playbackRate: 1, shouldCorrectPitch: false, isLive: false, currentOffsetFromLive: null, error: null };
});
afterEach(cleanup);

it('offers a real play action and exposes playback exceptions inline', async () => {
  audio.playError = 'Opus codec is unsupported';
  render(<ReceivedAudio uri="http://mesh.test/messages/voice/content" />);
  fireEvent.click(screen.getByLabelText('Play received audio'));
  expect(await screen.findByText(/Playback unavailable.*Opus codec is unsupported/)).toBeTruthy();
});

it('surfaces native loading errors without offering an enabled play action', () => {
  audio.status = { ...audio.status, isLoaded: false, error: 'Cannot decode Ogg container' };
  render(<ReceivedAudio uri="http://mesh.test/messages/voice/content" />);
  expect(screen.getByText(/Playback unavailable.*Cannot decode Ogg container/)).toBeTruthy();
  expect(screen.getByLabelText('Play received audio').getAttribute('aria-disabled')).toBe('true');
});

it('reflects playing state from the player and shows observed duration', () => {
  audio.status = { ...audio.status, playing: true, currentTime: 2 };
  render(<ReceivedAudio uri="http://mesh.test/messages/voice/content" />);
  expect(screen.getByLabelText('Pause received audio')).toBeTruthy();
  expect(screen.getByText('0:02 / 0:05')).toBeTruthy();
  expect(screen.getByText('Verified voice message')).toBeTruthy();
});
