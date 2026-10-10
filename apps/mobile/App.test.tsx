import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('expo-document-picker', () => ({ getDocumentAsync: async () => ({ canceled: true, assets: null }) }));
const audio = vi.hoisted(() => {
  const recorder = { uri: 'file:///voice.m4a', isRecording: false, prepareToRecordAsync: async () => {}, record: () => { recorder.isRecording = true; }, stop: vi.fn(async () => { recorder.isRecording = false; }) };
  return { recorder };
});
vi.mock('expo-audio', () => ({
  useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}),
  useAudioRecorder: () => audio.recorder,
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: async () => {},
}));
beforeEach(() => { audio.recorder.isRecording = false; audio.recorder.stop.mockClear(); });
afterEach(cleanup);

it('switches the native phone between boss and employee identities', () => {
  render(<App />);
  expect(screen.getByText('NODE0')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Use employee phone'));
  expect(screen.getByText('NODE4')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Use boss phone'));
  expect(screen.getByText('NODE0')).toBeTruthy();
});

it('keeps replay visible when a malformed backend URL is submitted', () => {
  render(<App />);
  fireEvent.click(screen.getByLabelText('Open connection settings'));
  fireEvent.change(screen.getByLabelText('Backend URL'), { target: { value: 'file:///unsafe' } });
  fireEvent.click(screen.getByLabelText('Apply backend URL'));
  expect(screen.getByText(/Enter an http/)).toBeTruthy();
  expect(screen.getByText('Sample replay · example messages')).toBeTruthy();
});

it('offers recording in live mode and stops the microphone when switching roles', async () => {
  render(<App />);
  expect(screen.queryByLabelText('Record voice')).toBeNull();
  fireEvent.click(screen.getByLabelText('Open connection settings'));
  fireEvent.click(screen.getByLabelText('Use live backend'));
  fireEvent.click(await screen.findByLabelText('Record voice'));
  await screen.findByLabelText('Stop recording');
  fireEvent.click(screen.getByLabelText('Use employee phone'));
  await waitFor(() => expect(audio.recorder.stop).toHaveBeenCalled());
  expect(screen.getByLabelText('Record voice')).toBeTruthy();
  expect(screen.getByText('NODE4')).toBeTruthy();
});
