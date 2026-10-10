import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { AiModel, AiRequest, AiState, MeshClient, MeshMessage, MeshState, Mode } from '@teamwater/core';
import { normalizeAi } from '../../core/src/snapshot';
import { PhoneChat } from './index';
import { AiChat } from './AiChat';

afterEach(cleanup);

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return { id: 'r1', asker: 'node0', gateway: 'node5', question: 'How fast is Long Fast?', modelIndex: 0, model: 'mistral/ministral-8b',
    stage: 'to_gateway', stages: [], attempts: 1, requestMessageIds: ['q1'], answerMessageIds: [], answer: null, outcome: null,
    sources: [], receipt: false, error: '', note: '', createdAt: 1, ...overrides };
}
function msg(overrides: Partial<MeshMessage>): MeshMessage {
  return { id: 'q1', src: 'node0', dst: 'node5', kind: 'ai_request', preview: 'Sealed AI question', totalChunks: 3, received: 1, acked: 0,
    status: 'in_transit', route: ['node0', 'node1', 'node5'], createdAt: 1000, etaSeconds: null, integrity: 'unverified', receiptConfirmed: false, ...overrides };
}

class FakeClient implements MeshClient {
  asked: [string, string, number | undefined][] = [];
  state: MeshState = { mode: 'live', connection: 'connected', endpoint: '', nodes: [], links: [], messages: {}, events: [],
    config: { bitRate: null, lossRate: null, rangeMeters: null, playbackSpeed: 1 }, capabilities: { packetEvents: true, controls: false, verifiedContent: true },
    scenario: 'clean', error: null, ai: { internetNode: 'node5', connectedNodes: ['node0', 'node4', 'node5'], requests: [] } };
  listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  set(patch: Partial<MeshState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(l => l()); }
  start() {} dispose() {} setMode(mode: Mode) { this.set({ mode }); } setScenario() {} setPlaybackSpeed() {} reset() {}
  async sendText() { return 'x'; } async sendMedia() { return 'x'; }
  async askAi(src: string, q: string, i?: number) { this.asked.push([src, q, i]); return 'r9'; }
  async listModels(): Promise<AiModel[]> { return [{ index: 0, id: 'mistral/ministral-8b', provider: 'mistral', label: 'ministral-8b', tier: '$', privacy: 'Nicrron opted out of training', privacyLevel: 'ok' }]; }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const ai = (requests: AiRequest[]): AiState => ({ internetNode: 'node5', connectedNodes: ['node0', 'node4', 'node5'], requests });

describe('Water AI tab', () => {
  it('preserves a follow-up draft typed while a question is submitting', async () => {
    const client = new FakeClient();
    const submission = deferred<string>();
    client.askAi = () => submission.promise;
    render(<AiChat client={client} src="node0"/>);
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'First question' } });
    fireEvent.click(screen.getByLabelText('Send question'));
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'Follow-up question' } });
    await act(async () => submission.resolve('r1'));
    expect(screen.getByLabelText('Ask Water AI')).toHaveValue('Follow-up question');
  });

  it('releases the composer on endpoint change and ignores the old request failure', async () => {
    const client = new FakeClient();
    const submission = deferred<string>();
    client.askAi = () => submission.promise;
    render(<AiChat client={client} src="node0"/>);
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'First question' } });
    fireEvent.click(screen.getByLabelText('Send question'));
    act(() => client.set({ endpoint: '/other' }));
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'New endpoint question' } });
    expect(screen.getByLabelText('Send question')).not.toHaveAttribute('aria-disabled', 'true');
    await act(async () => submission.reject(new Error('Old endpoint failed')));
    expect(screen.queryByText('Old endpoint failed')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ask Water AI')).toHaveValue('New endpoint question');
  });

  it('keeps the current endpoint catalog when an old catalog arrives late', async () => {
    const client = new FakeClient();
    const oldCatalog = deferred<AiModel[]>();
    const currentCatalog = deferred<AiModel[]>();
    const model = (label: string): AiModel => ({ index: 0, id: `test/${label}`, provider: 'test', label, tier: '$', privacy: 'Unknown', privacyLevel: 'unknown' });
    client.listModels = () => client.state.endpoint === '/other' ? currentCatalog.promise : oldCatalog.promise;
    render(<AiChat client={client} src="node0"/>);
    act(() => client.set({ endpoint: '/other' }));
    await act(async () => currentCatalog.resolve([model('Current model')]));
    expect(screen.getByText('Model: Current model')).toBeInTheDocument();
    await act(async () => oldCatalog.resolve([model('Old model')]));
    expect(screen.queryByText('Model: Old model')).not.toBeInTheDocument();
    expect(screen.getByText('Model: Current model')).toBeInTheDocument();
  });

  it('clears a submitted draft under StrictMode without getting stuck busy', async () => {
    const client = new FakeClient();
    render(<StrictMode><AiChat client={client} src="node0"/></StrictMode>);
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'Question' } });
    await act(async () => fireEvent.click(screen.getByLabelText('Send question')));
    expect(screen.getByLabelText('Ask Water AI')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'Next' } });
    expect(screen.getByLabelText('Send question')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('disables the AI composer and picker when the phone is locked for reset or demo', async () => {
    const client = new FakeClient();
    const picker = ({ disabled }: { disabled: boolean }) => <select aria-label="AI model" disabled={disabled}><option>Default</option></select>;
    const props = { client, role: 'boss' as const, aiTab: true, renderModelPicker: picker };
    const view = render(<PhoneChat {...props}/>);
    fireEvent.click(screen.getByLabelText('Water AI tab'));
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'Question' } });
    await screen.findByLabelText('AI model');
    view.rerender(<PhoneChat {...props} disabled/>);
    expect(screen.getByLabelText('Ask Water AI')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Send question')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('AI model')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Send question'));
    expect(client.asked).toHaveLength(0);
  });

  it('uses the service UTF-8 byte limit for sending non-ASCII questions', async () => {
    const client = new FakeClient();
    render(<AiChat client={client} src="node0"/>);
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'é'.repeat(201) } });
    expect(screen.getByLabelText('Send question')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByLabelText('Send question'));
    expect(client.asked).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'é'.repeat(200) } });
    expect(screen.getByText('400/400 B')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByLabelText('Send question')));
    expect(client.asked).toEqual([['node0', 'é'.repeat(200), 0]]);
  });

  it('does not claim an already-processed retry has never reached the AI', () => {
    const client = new FakeClient();
    client.set({ ai: ai([request({ stage: 'waiting_for_gateway', attempts: 2, stages: [{ stage: 'ai_working', at: 1 }] })]) });
    render(<AiChat client={client} src="node0"/>);
    expect(screen.queryByText('Nothing has been sent to the AI yet')).not.toBeInTheDocument();
  });

  it('keeps sealed AI transfers out of the normal chat', () => {
    const client = new FakeClient();
    client.set({ messages: { q1: msg({}), t1: msg({ id: 't1', kind: 'text', dst: 'node4', preview: 'hello', text: 'hello' }) } });
    render(<PhoneChat client={client} role="boss" conversation="playa" endpoints={{ src: 'node0', dst: 'node4' }} aiTab/>);
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.queryByText('Sealed AI question')).toBeNull();
  });

  it('shows mesh progress toward the gateway, then the grounded answer with its source', async () => {
    const client = new FakeClient();
    client.set({ messages: { q1: msg({}) }, ai: ai([request()]) });
    render(<PhoneChat client={client} role="boss" conversation="playa" endpoints={{ src: 'node0', dst: 'node4' }} aiTab nodeName={id => ({ node0: 'Malcome', node5: 'Frank' })[id] ?? id}/>);
    fireEvent.click(screen.getByLabelText('Water AI tab'));
    expect(screen.getByText('Gateway: Frank has internet')).toBeTruthy();
    expect(screen.getByText('Malcome → Frank · 1/3 chunks')).toBeTruthy();
    expect(screen.queryByText(/Opened on this phone/)).toBeTruthy(); // future step listed, not done
    act(() => client.set({ ai: ai([request({ stage: 'answered', outcome: 'ok', answer: 'Long Fast is about 1.07 kbps.', sources: ['field_guide-01'], receipt: true })]) }));
    expect(await screen.findByText('Long Fast is about 1.07 kbps.')).toBeTruthy();
    expect(screen.getByText('↳ Source: field_guide-01')).toBeTruthy();
    expect(screen.getByText(/not checked by a person/)).toBeTruthy();
  });

  it('is honest when no phone has internet and when the field guide has no answer', async () => {
    const client = new FakeClient();
    client.set({ ai: { ...ai([request({ stage: 'answered', outcome: 'no_grounding', answer: "I don't know: nothing in the field guide covers that." })]), internetNode: null } });
    render(<PhoneChat client={client} role="boss" conversation="playa" endpoints={{ src: 'node0', dst: 'node4' }} aiTab/>);
    fireEvent.click(screen.getByLabelText('Water AI tab'));
    expect(screen.getByText('No phone has internet: questions will wait')).toBeTruthy();
    expect(screen.getByText('Not in the field guide, so no model was asked')).toBeTruthy();
  });

  it('sends the question from this phone', async () => {
    const client = new FakeClient();
    render(<PhoneChat client={client} role="boss" conversation="playa" endpoints={{ src: 'node0', dst: 'node4' }} aiTab/>);
    fireEvent.click(screen.getByLabelText('Water AI tab'));
    fireEvent.change(screen.getByLabelText('Ask Water AI'), { target: { value: 'What does FAILED mean?' } });
    fireEvent.click(screen.getByLabelText('Send question'));
    await waitFor(() => expect(client.asked).toEqual([['node0', 'What does FAILED mean?', 0]]));
  });

  it('refuses in replay mode instead of faking an answer', () => {
    const client = new FakeClient();
    client.set({ mode: 'replay' });
    render(<PhoneChat client={client} role="boss" conversation="playa" endpoints={{ src: 'node0', dst: 'node4' }} aiTab/>);
    fireEvent.click(screen.getByLabelText('Water AI tab'));
    expect(screen.getByText(/Switch the console to Live/)).toBeTruthy();
  });
});

describe('normalizeAi', () => {
  it('parses service AI state and skips malformed requests', () => {
    const parsed = normalizeAi({ internet_node: 'node5', connected_nodes: ['node0'], requests: [
      { request_id: 'a', asker: 'node0', question: 'q', stage: 'answered', outcome: 'ok', answer: 'x', sources: ['f-01'], stages: [{ stage: 'answered', at: 2 }], created_at: 1 },
      { request_id: 'b', asker: 'node0', question: 'q', stage: 'bogus' },
    ] });
    expect(parsed?.internetNode).toBe('node5');
    expect(parsed?.requests.map(r => r.id)).toEqual(['a']);
    expect(parsed?.requests[0].stages[0].at).toBe(2000);
    expect(normalizeAi(undefined)).toBeNull();
  });
});
