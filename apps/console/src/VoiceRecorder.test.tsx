// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { MediaAsset } from '@teamwater/core';
import { VoiceRecorder } from './VoiceRecorder';

class Recorder extends EventTarget {
  static instances: Recorder[] = [];
  static supported = 'audio/webm;codecs=opus';
  static isTypeSupported(type: string) { return type === Recorder.supported; }
  state = 'inactive';
  mimeType: string;
  constructor(_stream: MediaStream, options: MediaRecorderOptions) { super(); this.mimeType = options.mimeType!; Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['voice-bytes'], { type: this.mimeType }) }));
    this.dispatchEvent(new Event('stop'));
  }
}
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
let stopTrack: ReturnType<typeof vi.fn>;
let stream: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); Recorder.instances = []; Recorder.supported = 'audio/webm;codecs=opus';
  stopTrack = vi.fn(); stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:voice-preview') });
  revoke = vi.fn(); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate); else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke); else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});
async function start() { fireEvent.click(screen.getByRole('button', { name: 'Record voice' })); await act(async () => {}); }
function stop() { fireEvent.click(screen.getByRole('button', { name: 'Stop recording' })); }

describe('browser voice recording', () => {
  it('requests the microphone only on press, records visible time, previews, and sends the actual clip', async () => {
    let sent: MediaAsset | undefined;
    render(<VoiceRecorder disabled={false} onSend={async asset => { sent = asset; }}/>);
    expect(getUserMedia).not.toHaveBeenCalled();
    await start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('status')).toHaveTextContent('2.0s / 5s');
    stop();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Recorded voice preview')).toHaveAttribute('src', 'blob:voice-preview');
    fireEvent.click(screen.getByRole('button', { name: 'Send voice' }));
    await act(async () => {});
    expect(sent?.file).toBeInstanceOf(Blob);
    expect(sent?.file?.size).toBe(11);
    expect(sent?.type).toBe('audio/webm;codecs=opus');
    expect(sent?.name).toMatch(/\.webm$/);
    expect(screen.getByRole('button', { name: 'Record voice' })).toBeEnabled();
    expect(revoke).toHaveBeenCalledWith('blob:voice-preview');
  });

  it('automatically stops at five seconds and uses supported MP4 when Opus is unavailable', async () => {
    Recorder.supported = 'audio/mp4';
    let sent: MediaAsset | undefined;
    render(<VoiceRecorder disabled={false} onSend={async asset => { sent = asset; }}/>);
    await start();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('button', { name: 'Stop recording' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Recorded voice preview')).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Send voice' })); await act(async () => {});
    expect(sent?.type).toBe('audio/mp4');
    expect(sent?.name).toMatch(/\.m4a$/);
  });

  it('retains the clip and offers another send after a transport failure', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('Radio service unavailable')).mockResolvedValueOnce(undefined);
    render(<VoiceRecorder disabled={false} onSend={onSend}/>);
    await start(); stop();
    fireEvent.click(screen.getByRole('button', { name: 'Send voice' })); await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('Radio service unavailable');
    expect(screen.getByLabelText('Recorded voice preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send voice' })).toBeEnabled();
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send voice' })); await act(async () => {});
    expect(screen.queryByLabelText('Recorded voice preview')).not.toBeInTheDocument();
  });

  it('discards a clip and releases its object URL', async () => {
    render(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    await start(); stop();
    fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }));
    expect(screen.queryByLabelText('Recorded voice preview')).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith('blob:voice-preview');
  });

  it.each([['NotAllowedError', 'Microphone permission denied'], ['NotFoundError', 'No microphone found']])('makes %s actionable without leaving the microphone active', async (name, message) => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Microphone failed', name));
    render(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    await start();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Record voice' })).toBeEnabled();
    expect(Recorder.instances).toHaveLength(0);
  });

  it('explains insecure origin requirements before requesting microphone access', async () => {
    vi.stubGlobal('isSecureContext', false);
    render(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    await start();
    expect(screen.getByRole('alert')).toHaveTextContent('HTTPS or localhost');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('cancels recording when the tab becomes hidden and never creates a background clip', async () => {
    render(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    await start();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Recorded voice preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record voice' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('tab was hidden');
  });

  it('stops an active recorder on unmount and ignores late permission resolution', async () => {
    const active = render(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    await start(); active.unmount();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    let resolvePermission!: (stream: MediaStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>(resolve => { resolvePermission = resolve; }));
    const pending = render(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Record voice' }));
    pending.unmount();
    await act(async () => resolvePermission(stream));
    expect(stopTrack).toHaveBeenCalledTimes(2);
    expect(Recorder.instances).toHaveLength(1);
  });

  it('honors transport busy state and releases a preview URL on unmount', async () => {
    const view = render(<VoiceRecorder disabled={true} onSend={async () => {}}/>);
    expect(screen.getByRole('button', { name: 'Record voice' })).toBeDisabled();
    view.rerender(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    await start(); stop(); view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:voice-preview');
  });

  it('ignores a canceled recorder stop event without clearing the new recording limit', async () => {
    render(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    await start();
    const old = Recorder.instances[0]!;
    vi.spyOn(old, 'stop').mockImplementation(() => { old.state = 'inactive'; });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    await start();
    act(() => { old.dispatchEvent(new Event('stop')); });
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText('Recorded voice preview')).toBeInTheDocument();
    expect(Recorder.instances[1]?.state).toBe('inactive');
  });

  it('ignores a stale permission rejection while a newer recording is active', async () => {
    let rejectPermission!: (reason: Error) => void;
    getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((_resolve, reject) => { rejectPermission = reject; }));
    render(<VoiceRecorder disabled={false} onSend={async () => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Record voice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' }));
    await start();
    await act(async () => rejectPermission(new Error('Old permission request failed')));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText('Recorded voice preview')).toBeInTheDocument();
  });
});
