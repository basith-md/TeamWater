import React from 'react';
import { Keyboard, Platform } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true }); });

function nativeKeyboard() {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  const listeners = new Map<string, () => void>();
  vi.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
    listeners.set(event, listener as () => void);
    return { remove: () => { listeners.delete(event); } } as ReturnType<typeof Keyboard.addListener>;
  });
  return (event: string) => { act(() => listeners.get(event)?.()); };
}

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

it('uses the protected preview connection without offering a different backend', () => {
  vi.stubEnv('EXPO_PUBLIC_TEAM_PREVIEW', 'true');
  render(<App />);
  expect(screen.getByText('Live simulation')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Open connection settings'));
  expect(screen.queryByLabelText('Backend URL')).toBeNull();
  expect(screen.queryByLabelText('Apply backend URL')).toBeNull();
  expect(screen.getByText('Connected through this protected team preview.')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Use demo replay'));
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

it('compacts native chrome on composer focus while retaining a multiline draft', () => {
  nativeKeyboard();
  const dismiss = vi.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  render(<App />);
  const composer = screen.getByLabelText('Message input') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: 'First line\nSecond line\nThird line' } });
  fireEvent.focus(composer);
  expect(screen.queryByText('A LITTLE SIGNAL GOES A LONG WAY')).toBeNull();
  expect(screen.queryByLabelText('Use boss phone')).toBeNull();
  expect(screen.getByLabelText('Message input')).toBe(composer);
  expect(composer.value).toBe('First line\nSecond line\nThird line');
  expect(screen.getByLabelText('Open connection settings')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Dismiss keyboard'));
  expect(dismiss).toHaveBeenCalled();
});

it('keeps the native shell compact until the keyboard closes and restores role controls', () => {
  const keyboard = nativeKeyboard();
  render(<App />);
  const composer = screen.getByLabelText('Message input');
  fireEvent.focus(composer);
  keyboard('keyboardWillShow');
  fireEvent.blur(composer);
  expect(screen.queryByLabelText('Use employee phone')).toBeNull();
  keyboard('keyboardWillHide');
  expect(screen.queryByLabelText('Use employee phone')).toBeNull();
  keyboard('keyboardDidHide');
  expect(screen.getByLabelText('Use employee phone')).toBeTruthy();
  expect(screen.getByText('A LITTLE SIGNAL GOES A LONG WAY')).toBeTruthy();
});

it('preserves backend editing while the native settings keyboard is open', () => {
  const keyboard = nativeKeyboard();
  render(<App />);
  fireEvent.click(screen.getByLabelText('Open connection settings'));
  const endpoint = screen.getByLabelText('Backend URL') as HTMLInputElement;
  fireEvent.focus(endpoint);
  fireEvent.change(endpoint, { target: { value: 'https://mesh.example.test' } });
  keyboard('keyboardWillShow');
  expect(screen.queryByLabelText('Use boss phone')).toBeNull();
  expect(screen.getByLabelText('Backend URL')).toBe(endpoint);
  expect(endpoint.value).toBe('https://mesh.example.test');
  expect(screen.getByLabelText('Apply backend URL')).toBeTruthy();
});

it('starts compact if a native keyboard was already visible before mounting', () => {
  nativeKeyboard();
  vi.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  render(<App />);
  expect(screen.queryByLabelText('Use boss phone')).toBeNull();
  expect(screen.getByLabelText('Dismiss keyboard')).toBeTruthy();
});

it('compacts hosted web while typing without remounting the draft or recorder', () => {
  vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://mesh.example.test');
  render(<App />);
  const composer = screen.getByLabelText('Message input') as HTMLTextAreaElement;
  const recorder = screen.getByLabelText('Record voice');
  fireEvent.change(composer, { target: { value: 'Web draft\nSecond line' } });
  act(() => composer.focus());
  expect(screen.queryByLabelText('Use employee phone')).toBeNull();
  expect(screen.queryByText('A LITTLE SIGNAL GOES A LONG WAY')).toBeNull();
  expect(screen.getByLabelText('Message input')).toBe(composer);
  expect(composer.value).toBe('Web draft\nSecond line');
  expect(screen.getByLabelText('Record voice')).toBe(recorder);
  fireEvent.click(screen.getByLabelText('Dismiss keyboard'));
  expect(screen.getByLabelText('Use employee phone')).toBeTruthy();
  expect(composer.value).toBe('Web draft\nSecond line');
});

it('constrains hosted web to the visible browser height as the keyboard resizes it', () => {
  const viewport = Object.assign(new EventTarget(), { height: 740 });
  vi.stubGlobal('visualViewport', viewport);
  const { container, unmount } = render(<App />);
  const shell = container.firstElementChild as HTMLElement;
  expect(shell.style.maxHeight).toBe('740px');
  act(() => { viewport.height = 410; viewport.dispatchEvent(new Event('resize')); });
  expect(shell.style.maxHeight).toBe('410px');
  act(() => { viewport.height = 740; viewport.dispatchEvent(new Event('resize')); });
  expect(shell.style.maxHeight).toBe('740px');
  unmount();
});
