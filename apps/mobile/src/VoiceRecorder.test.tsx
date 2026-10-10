import React from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MediaAsset } from '@teamwater/core';
import { VoiceRecorder } from './VoiceRecorder';

const hardware = vi.hoisted(() => {
  const recorder = { uri: 'file:///voice.m4a', isRecording: false, prepareToRecordAsync: vi.fn(async () => {}), record: vi.fn(() => { recorder.isRecording = true; }), stop: vi.fn(async () => { recorder.isRecording = false; }), getStatus: () => ({ isRecording: recorder.isRecording, durationMillis: 1000, canRecord: true, mediaServicesDidReset: false, url: recorder.uri }) };
  return { recorder, permission: vi.fn(async () => ({ granted: true })), mode: vi.fn(async (_mode: object) => {}), statusListener: null as null | ((status: { isFinished: boolean; hasError: boolean; error: string | null; url: string | null }) => void) };
});
vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000, android: { outputFormat: 'mpeg4', audioEncoder: 'aac' }, ios: { outputFormat: 'aac ' }, web: { mimeType: 'audio/webm' } } },
  requestRecordingPermissionsAsync: hardware.permission, setAudioModeAsync: hardware.mode,
  useAudioRecorder: (_options: unknown, listener: typeof hardware.statusListener) => { hardware.statusListener = listener; return hardware.recorder; },
  useAudioPlayer: () => ({ play() {}, pause() {}, seekTo: async () => {} }),
  useAudioPlayerStatus: () => ({ playing: false, isLoaded: true, didJustFinish: false, currentTime: 0, duration: 1, error: null }),
}));

beforeEach(() => { vi.clearAllMocks(); hardware.recorder.isRecording = false; hardware.permission.mockResolvedValue({ granted: true }); hardware.recorder.prepareToRecordAsync.mockResolvedValue(undefined); hardware.recorder.stop.mockImplementation(async () => { hardware.recorder.isRecording = false; }); hardware.statusListener = null; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function recordAndStop() {
  fireEvent.click(screen.getByLabelText('Record voice'));
  await screen.findByLabelText('Stop recording');
  fireEvent.click(screen.getByLabelText('Stop recording'));
  await screen.findByLabelText('Send voice');
}

it('requests microphone permission only on record and explains a denial', async () => {
  hardware.permission.mockResolvedValue({ granted: false });
  render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  expect(hardware.permission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Record voice'));
  expect(await screen.findByText(/Microphone permission is required/)).toBeTruthy();
  expect(screen.queryByLabelText('Send voice')).toBeNull();
  expect(hardware.recorder.record).not.toHaveBeenCalled();
});

it('records an AAC clip, restores playback mode, previews, then sends it', async () => {
  let sent: MediaAsset | null = null;
  render(<VoiceRecorder onSend={async asset => { sent = asset; }} disabled={false}/>);
  await recordAndStop();
  expect(screen.getByLabelText('Play voice preview')).toBeTruthy();
  expect(hardware.mode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));
  fireEvent.click(screen.getByLabelText('Send voice'));
  await screen.findByLabelText('Record voice');
  expect(sent).toEqual({ uri: 'file:///voice.m4a', name: 'voice.m4a', type: 'audio/mp4' });
});

it('retains the recorded clip after a failed send and allows retry or discard', async () => {
  let fail = true;
  render(<VoiceRecorder onSend={async () => { if (fail) throw new Error('Mesh unavailable'); }} disabled={false}/>);
  await recordAndStop();
  fireEvent.click(screen.getByLabelText('Send voice'));
  expect(await screen.findByText('Mesh unavailable')).toBeTruthy();
  expect(screen.getByLabelText('Play voice preview')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByLabelText('Send voice'));
  await screen.findByLabelText('Record voice');
  await recordAndStop();
  fireEvent.click(screen.getByLabelText('Discard voice'));
  expect(screen.getByLabelText('Record voice')).toBeTruthy();
  expect(screen.queryByLabelText('Play voice preview')).toBeNull();
});

it('shows elapsed recording duration and automatically stops at five seconds', async () => {
  vi.useFakeTimers();
  render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  await act(async () => fireEvent.click(screen.getByLabelText('Record voice')));
  await act(async () => { vi.advanceTimersByTime(2200); });
  expect(screen.getByText('2.2 / 5.0 seconds')).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(2800); });
  expect(screen.getByLabelText('Send voice')).toBeTruthy();
  expect(hardware.recorder.record).toHaveBeenCalledWith({ forDuration: 5 });
  expect(hardware.recorder.stop).toHaveBeenCalledTimes(1);
});

it('discards an active recording on background and restores playback mode', async () => {
  let background!: (state: AppStateStatus) => void;
  vi.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { background = listener; return { remove() {} }; });
  render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  fireEvent.click(screen.getByLabelText('Record voice'));
  await screen.findByLabelText('Stop recording');
  await act(async () => background('background'));
  expect(screen.getByLabelText('Record voice')).toBeTruthy();
  expect(screen.queryByLabelText('Send voice')).toBeNull();
  expect(hardware.recorder.stop).toHaveBeenCalled();
  expect(hardware.mode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));
});

it('continues after the iOS permission prompt temporarily makes the app inactive', async () => {
  let changeState!: (state: AppStateStatus) => void;
  let allow!: (value: { granted: boolean }) => void;
  vi.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { changeState = listener; return { remove() {} }; });
  hardware.permission.mockReturnValue(new Promise(resolve => { allow = resolve; }));
  render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  fireEvent.click(screen.getByLabelText('Record voice'));
  await waitFor(() => expect(hardware.permission).toHaveBeenCalled());
  act(() => changeState('inactive'));
  await act(async () => { changeState('active'); allow({ granted: true }); });
  expect(await screen.findByLabelText('Stop recording')).toBeTruthy();
  expect(hardware.recorder.isRecording).toBe(true);
});

it('does not start a microphone after an old permission request resolves on unmount', async () => {
  let allow!: (value: { granted: boolean }) => void;
  hardware.permission.mockReturnValue(new Promise(resolve => { allow = resolve; }));
  const view = render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  fireEvent.click(screen.getByLabelText('Record voice'));
  view.unmount();
  await act(async () => allow({ granted: true }));
  expect(hardware.recorder.record).not.toHaveBeenCalled();
});

it('stops recording and restores playback mode on unmount', async () => {
  const view = render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  fireEvent.click(screen.getByLabelText('Record voice'));
  await screen.findByLabelText('Stop recording');
  view.unmount();
  await waitFor(() => expect(hardware.mode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false })));
  expect(hardware.recorder.stop).toHaveBeenCalled();
});

it('restores playback mode and reports preparation errors', async () => {
  hardware.recorder.prepareToRecordAsync.mockRejectedValue(new Error('Microphone unavailable'));
  render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  fireEvent.click(screen.getByLabelText('Record voice'));
  expect(await screen.findByText('Microphone unavailable')).toBeTruthy();
  expect(hardware.mode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));
  expect(screen.getByLabelText('Record voice')).toBeTruthy();
});

it('lets a new recording survive cancellation of an older pending native preparation', async () => {
  let background!: (state: AppStateStatus) => void;
  let finishOld!: () => void;
  vi.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { background = listener; return { remove() {} }; });
  hardware.recorder.prepareToRecordAsync.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  fireEvent.click(screen.getByLabelText('Record voice'));
  await waitFor(() => expect(hardware.recorder.prepareToRecordAsync).toHaveBeenCalled());
  await act(async () => background('background'));
  fireEvent.click(screen.getByLabelText('Record voice'));
  await act(async () => {});
  await act(async () => finishOld());
  await screen.findByLabelText('Stop recording');
  expect(hardware.recorder.isRecording).toBe(true);
  expect(hardware.mode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: true }));
});

it('stops active capture if the shared transport becomes busy', async () => {
  const view = render(<VoiceRecorder onSend={async () => {}} disabled={false}/>);
  fireEvent.click(screen.getByLabelText('Record voice'));
  await screen.findByLabelText('Stop recording');
  view.rerender(<VoiceRecorder onSend={async () => {}} disabled/>);
  await waitFor(() => expect(screen.queryByLabelText('Stop recording')).toBeNull());
  expect(hardware.recorder.isRecording).toBe(false);
  expect(screen.queryByLabelText('Send voice')).toBeNull();
});
