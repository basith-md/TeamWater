import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AiRequest, AiState, MeshClient, MeshMessage, MeshState, Mode } from '@teamwater/core';
import { normalizeAi } from '../../core/src/snapshot';
import { PhoneChat } from './index';

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
  async listModels() { return [{ index: 0, id: 'mistral/ministral-8b', provider: 'mistral', label: 'ministral-8b', tier: '$', privacy: 'Nicrron opted out of training', privacyLevel: 'ok' as const }]; }
}

const ai = (requests: AiRequest[]): AiState => ({ internetNode: 'node5', connectedNodes: ['node0', 'node4', 'node5'], requests });

describe('Water AI tab', () => {
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
    client.set({ ai: ai([request({ stage: 'answered', outcome: 'ok', answer: 'Long Fast is about 1.07 kbps.', sources: ['field_guide-01'], receipt: true })]) });
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
