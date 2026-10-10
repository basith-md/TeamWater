import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaAsset, MeshClient, MeshMessage, MeshState, Mode } from '@teamwater/core';
import { PhoneChat } from './index';

afterEach(cleanup);

function message(overrides: Partial<MeshMessage> = {}): MeshMessage {
  return { id: 'm1', src: 'node0', dst: 'node4', kind: 'text', preview: 'Fix the code', text: 'Fix the code', totalChunks: 4, received: 4, acked: 4, status: 'delivered', route: ['node0', 'node4'], createdAt: 1000, etaSeconds: null, integrity: 'unverified', receiptConfirmed: false, ...overrides };
}

class FakeClient implements MeshClient {
  state: MeshState = { mode: 'live', connection: 'connected', endpoint: 'http://localhost:8000', nodes: [], links: [], messages: {}, events: [], config: { bitRate: null, lossRate: null, rangeMeters: null, playbackSpeed: 1 }, capabilities: { packetEvents: false, controls: false, verifiedContent: false }, scenario: 'clean', error: null };
  listeners = new Set<() => void>();
  failure: string | null = null;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  publish(messages: MeshMessage[]) { this.state = { ...this.state, messages: Object.fromEntries(messages.map(item => [item.id, item])) }; this.listeners.forEach(listener => listener()); }
  start() {} dispose() {} setMode(mode: Mode, endpoint = this.state.endpoint) { this.state = { ...this.state, mode, endpoint, messages: {} }; this.listeners.forEach(listener => listener()); } setScenario() {} setPlaybackSpeed() {} reset() {}
  async sendText(src: string, dst: string, text: string) { if (this.failure) throw new Error(this.failure); this.publish([...Object.values(this.state.messages), message({ id: 'sent', src, dst, text, preview: text, status: 'sending', received: 0, acked: 0 })]); return 'sent'; }
  async sendMedia(src: string, dst: string, kind: 'image' | 'voice', asset: MediaAsset) { if (this.failure) throw new Error(this.failure); this.publish([message({ id: 'media', src, dst, kind, preview: asset.name, text: undefined })]); return 'media'; }
}

describe('PhoneChat', () => {
  it('shows both directions for the role and hides unrelated messages', () => {
    const client = new FakeClient();
    client.publish([message(), message({ id: 'reply', src: 'node4', dst: 'node0', text: 'I am at Burning Man', preview: 'I am at Burning Man' }), message({ id: 'other', src: 'node2', dst: 'node3', text: 'Private relay message', preview: 'Private relay message' })]);
    render(<PhoneChat client={client} role="employee" />);
    expect(screen.getByText('Fix the code')).toBeTruthy();
    expect(screen.getByText('I am at Burning Man')).toBeTruthy();
    expect(screen.queryByText('Private relay message')).toBeNull();
    expect(screen.getByLabelText('Message input')).toBeTruthy();
  });

  it('sends a trimmed employee reply to the boss and clears only a successful draft', async () => {
    const client = new FakeClient();
    render(<PhoneChat client={client} role="employee" />);
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: '  Working on it  ' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() => expect((screen.getByLabelText('Message input') as HTMLInputElement).value).toBe(''));
    expect(screen.getByText('Working on it')).toBeTruthy();
    expect(client.state.messages.sent.src).toBe('node4');
    expect(client.state.messages.sent.dst).toBe('node0');
  });

  it('retains a failed draft and allows a successful retry', async () => {
    const client = new FakeClient(); client.failure = 'Relay unavailable';
    render(<PhoneChat client={client} role="employee" />);
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'Try this patch' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    await screen.findByText('Relay unavailable');
    expect((screen.getByLabelText('Message input') as HTMLInputElement).value).toBe('Try this patch');
    client.failure = null;
    await waitFor(() => expect(screen.getByLabelText('Send message').getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() => expect((screen.getByLabelText('Message input') as HTMLInputElement).value).toBe(''));
    expect(screen.queryByText('Relay unavailable')).toBeNull();
  });

  it('never describes ACK-only state as delivered and updates after a verified receipt', () => {
    const client = new FakeClient(); client.publish([message()]);
    render(<PhoneChat client={client} role="boss" />);
    expect(screen.getByText(/ACK received/)).toBeTruthy();
    expect(screen.queryByText(/^Delivered$/)).toBeNull();
    act(() => client.publish([message({ integrity: 'verified', receiptConfirmed: true })]));
    expect(screen.getByText('Delivered')).toBeTruthy();
  });

  it('labels live text as an unverified preview and exposes unavailable media honestly', () => {
    const client = new FakeClient(); client.publish([message({ kind: 'voice', preview: 'voice preview', text: undefined })]);
    render(<PhoneChat client={client} role="employee" />);
    expect(screen.getByText(/Playback unavailable/)).toBeTruthy();
    expect(screen.getByText(/Unverified preview/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Attach image'));
    expect(screen.getByText(/File selection is unavailable/)).toBeTruthy();
  });

  it('sends a user-selected audio file and shows its filename', async () => {
    const client = new FakeClient();
    render(<PhoneChat client={client} role="employee" pickMedia={async () => ({ uri: 'file:///patch.m4a', name: 'patch.m4a', type: 'audio/mp4' })} />);
    fireEvent.click(screen.getByLabelText('Attach voice file'));
    await screen.findByText('patch.m4a');
    expect(client.state.messages.media.kind).toBe('voice');
    expect(client.state.messages.media.src).toBe('node4');
  });

  it('keeps a draft edited while the earlier message is being sent', async () => {
    const client = new FakeClient();
    let finish!: (id: string) => void;
    client.sendText = () => new Promise(resolve => { finish = resolve; });
    render(<PhoneChat client={client} role="employee" />);
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'First draft' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'Next draft' } });
    await act(async () => finish('first'));
    expect((screen.getByLabelText('Message input') as HTMLInputElement).value).toBe('Next draft');
  });

  it('hides recipient replay content until all chunks are received and integrity is verified', () => {
    const client = new FakeClient(); client.setMode('replay');
    client.publish([message({ text: 'Secret patch contents', preview: 'Secret patch contents', received: 1, status: 'in_transit' })]);
    render(<PhoneChat client={client} role="employee" />);
    expect(screen.queryByText('Secret patch contents')).toBeNull();
    expect(screen.getByText(/Receiving text/)).toBeTruthy();
    act(() => client.publish([message({ text: 'Secret patch contents', received: 4, integrity: 'verified', receiptConfirmed: false, status: 'reassembled' })]));
    expect(screen.getByText('Secret patch contents')).toBeTruthy();
    expect(screen.queryByText('Delivered')).toBeNull();
  });

  it('does not show a live recipient preview before any chunk arrives', () => {
    const client = new FakeClient(); client.publish([message({ text: undefined, preview: 'Truncated remote preview', received: 0, status: 'sending' })]);
    render(<PhoneChat client={client} role="employee" />);
    expect(screen.queryByText('Truncated remote preview')).toBeNull();
    act(() => client.publish([message({ text: undefined, preview: 'Truncated remote preview', received: 1, status: 'in_transit' })]));
    expect(screen.getByText('Truncated remote preview')).toBeTruthy();
    expect(screen.getByText(/Unverified preview/)).toBeTruthy();
  });

  it('ignores an old send failure after a mode switch and lets the new session compose', async () => {
    const client = new FakeClient();
    let fail!: (error: Error) => void;
    client.sendText = () => new Promise((_resolve, reject) => { fail = reject; });
    render(<PhoneChat client={client} role="employee" />);
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'Old draft' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    act(() => client.setMode('replay'));
    fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'New draft' } });
    await act(async () => fail(new Error('Stale failure')));
    expect(screen.queryByText('Stale failure')).toBeNull();
    expect((screen.getByLabelText('Message input') as HTMLInputElement).value).toBe('New draft');
    expect(screen.getByLabelText('Send message').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows receiver verified content before sender terminal receipt without claiming Delivered', () => {
    const client = new FakeClient(); client.publish([message({ text: 'Full verified receiver text', integrity: 'verified', receiptConfirmed: false, status: 'reassembled' })]);
    const view = render(<PhoneChat client={client} role="employee" />);
    expect(screen.getByText('Full verified receiver text')).toBeTruthy();
    expect(screen.getByText('Receiver verified')).toBeTruthy();
    expect(screen.queryByText(/Unverified preview/)).toBeNull();
    expect(screen.queryByText('Delivered')).toBeNull();
    view.rerender(<PhoneChat client={client} role="boss" />);
    expect(screen.queryByText('Delivered')).toBeNull();
    expect(screen.getByText(/receipt pending/i)).toBeTruthy();
  });

  it('renders live verified image bytes and never renders an unverified media URL', () => {
    const client = new FakeClient(); client.publish([message({ kind: 'image', text: undefined, integrity: 'verified', receiptConfirmed: false, mediaUrl: 'http://mesh.test/messages/m1/content' })]);
    render(<PhoneChat client={client} role="employee" />);
    expect(screen.getByLabelText('Verified received image')).toBeTruthy();
    expect(screen.queryByText(/Image viewing unavailable/)).toBeNull();
    act(() => client.publish([message({ kind: 'image', text: undefined, mediaUrl: 'http://mesh.test/messages/m1/content' })]));
    expect(screen.queryByLabelText('Verified received image')).toBeNull();
    expect(screen.getByText(/Image viewing unavailable/)).toBeTruthy();
  });

  it('renders optional audio only for live verified receiver media', () => {
    const client = new FakeClient();
    client.publish([message({ kind: 'voice', text: undefined, integrity: 'verified', receiptConfirmed: false, mediaUrl: 'http://mesh.test/messages/m1/content' })]);
    render(<PhoneChat client={client} role="employee" renderAudio={uri => <Text>Audio controls for {uri}</Text>} />);
    expect(screen.getByText('Audio controls for http://mesh.test/messages/m1/content')).toBeTruthy();
    expect(screen.queryByText(/Playback unavailable/)).toBeNull();
    act(() => client.publish([message({ kind: 'voice', text: undefined, mediaUrl: 'http://mesh.test/messages/m1/content' })]));
    expect(screen.queryByText('Audio controls for http://mesh.test/messages/m1/content')).toBeNull();
    expect(screen.getByText(/Playback unavailable/)).toBeTruthy();
  });

  it('explains when a view cannot play verified audio instead of pretending reconstruction is missing', () => {
    const client = new FakeClient(); client.publish([message({ kind: 'voice', text: undefined, integrity: 'verified', mediaUrl: 'http://mesh.test/messages/m1/content' })]);
    render(<PhoneChat client={client} role="employee" />);
    expect(screen.getByText(/Playback unavailable in this view/)).toBeTruthy();
    expect(screen.queryByText(/reconstruction is not provided/)).toBeNull();
  });

  it('orders messages with an unknown backend creation time after known timestamps', () => {
    const client = new FakeClient();
    client.publish([message({ id: 'unknown', text: 'Unknown timestamp', createdAt: null }), message({ id: 'known', text: 'Known timestamp', createdAt: 1000 })]);
    render(<PhoneChat client={client} role="boss" />);
    expect(screen.getAllByText(/^(Known|Unknown) timestamp$/).map(element => element.textContent)).toEqual(['Known timestamp', 'Unknown timestamp']);
  });

  it('sends a recorded voice asset from employee to boss through the shared transport', async () => {
    const client = new FakeClient();
    render(<PhoneChat client={client} role="employee" renderVoiceRecorder={({ onSend, disabled }) => <Pressable accessibilityRole="button" accessibilityLabel="Send recorded voice" disabled={disabled} onPress={() => { void onSend({ uri: 'file:///recording.m4a', name: 'recording.m4a', type: 'audio/mp4' }).catch(() => {}); }}><Text>Send recorded voice</Text></Pressable>}/>);
    fireEvent.click(screen.getByLabelText('Send recorded voice'));
    await screen.findByText('recording.m4a');
    expect(client.state.messages.media.kind).toBe('voice');
    expect(client.state.messages.media.src).toBe('node4');
    expect(client.state.messages.media.dst).toBe('node0');
  });

  it('offers recording only in live mode and remounts recorder state after endpoint changes', () => {
    function RecorderChoice() {
      const [started, setStarted] = useState(false);
      return <Pressable accessibilityRole="button" accessibilityLabel="Start test recorder" onPress={() => setStarted(true)}><Text>{started ? 'Recording choice active' : 'Recorder idle'}</Text></Pressable>;
    }
    const client = new FakeClient(); client.setMode('replay');
    render(<PhoneChat client={client} role="boss" renderVoiceRecorder={() => <RecorderChoice/>}/>);
    expect(screen.queryByText('Recorder idle')).toBeNull();
    expect(screen.getByLabelText('Voice recording requires Live mode')).toBeTruthy();
    act(() => client.setMode('live'));
    fireEvent.click(screen.getByLabelText('Start test recorder'));
    expect(screen.getByText('Recording choice active')).toBeTruthy();
    act(() => client.setMode('live', 'http://another-host:8000'));
    expect(screen.getByText('Recorder idle')).toBeTruthy();
  });

  it('distinguishes incoming Receiving from outgoing Sending on both phones', () => {
    const client = new FakeClient();
    client.publish([message({ status: 'sending', received: 0 }), message({ id: 'reply', src: 'node4', dst: 'node0', text: 'Reply coming', status: 'in_transit', received: 2 })]);
    const view = render(<PhoneChat client={client} role="boss"/>);
    expect(screen.getByText('Sending')).toBeTruthy();
    expect(screen.getByText('Receiving…')).toBeTruthy();
    view.rerender(<PhoneChat client={client} role="employee"/>);
    expect(screen.getByText('In transit')).toBeTruthy();
    expect(screen.getByText('Receiving…')).toBeTruthy();
    expect(screen.queryByText('Sending')).toBeNull();
  });

  it('describes completed unverified recipient content and transfer failures honestly', () => {
    const client = new FakeClient(); client.publish([message()]);
    render(<PhoneChat client={client} role="employee"/>);
    expect(screen.getByText('Received · unverified')).toBeTruthy();
    expect(screen.queryByText('Delivered')).toBeNull();
    act(() => client.publish([message({ status: 'failed', received: 2 })]));
    expect(screen.getByText('Transfer failed')).toBeTruthy();
  });

  it('describes an incoming cancelled transfer without implying it is still receiving', () => {
    const client = new FakeClient(); client.publish([message({ status: 'cancelled', received: 2 })]);
    render(<PhoneChat client={client} role="employee"/>);
    expect(screen.getByText('Transfer cancelled')).toBeTruthy();
    expect(screen.queryByText('Receiving…')).toBeNull();
  });
});
