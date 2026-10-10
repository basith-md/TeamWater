// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import '@testing-library/jest-dom/vitest';
import type { MeshEvent, MeshMessage, MeshState } from '@teamwater/core';
import { Topology } from './App';

const message: MeshMessage = { id: 'm1', src: 'node0', dst: 'node4', kind: 'text', preview: 'Hello', totalChunks: 1, received: 1, acked: 1, status: 'delivered', route: ['node0', 'node2', 'node4'], createdAt: 0, integrity: 'verified', receiptConfirmed: true, etaSeconds: null };
const state: MeshState = { mode: 'replay', connection: 'connected', endpoint: '/api', messages: { m1: message }, events: [], error: null, scenario: 'clean', config: { bitRate: null, lossRate: null, rangeMeters: null, playbackSpeed: 1 }, capabilities: { packetEvents: true, controls: false, verifiedContent: true }, nodes: [{ id: 'node0', name: 'Alex', x: 0, y: 0, color: '#fff', online: true }, { id: 'node2', name: 'Relay', x: 100, y: 100, color: '#fff', online: true }, { id: 'node4', name: 'Jordan', x: 200, y: 0, color: '#fff', online: true }], links: [{ from: 'node0', to: 'node2' }, { from: 'node2', to: 'node4' }] };
const hop = (sequence: number, from = 'node0', to = 'node2'): MeshEvent => ({ id: `event-${sequence}`, sequence, at: sequence * 10, messageId: 'm1', kind: 'packet_tx', from, to, packetId: `packet-${sequence}`, bytes: 64 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const playback = () => screen.getByRole('status', { name: 'Trace playback status' });

describe('observed packet trace playback', () => {
  it('plays rapid batched transmit hops in order long enough to see each hop', () => {
    render(<Topology state={state} message={message} events={[hop(1), { ...hop(2), kind: 'packet_rx' }, hop(3, 'node2', 'node4')]}/>);
    expect(playback()).toHaveTextContent('node0 → node2');
    expect(playback()).toHaveTextContent('1 hop queued');
    const packet = screen.getByTestId('trace-packet');
    expect(packet).toHaveAttribute('data-event-id', 'event-1');
    expect(packet.parentElement?.lastElementChild).toBe(packet);
    act(() => vi.advanceTimersByTime(599));
    expect(packet).toHaveAttribute('data-event-id', 'event-1');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-3');
    expect(playback()).toHaveTextContent('node2 → node4');
  });

  it('queues incoming observed events without restarting the current hop or replaying duplicates', () => {
    const view = render(<Topology state={state} message={message} events={[hop(1)]}/>);
    act(() => vi.advanceTimersByTime(300));
    view.rerender(<Topology state={state} message={message} events={[hop(1), hop(2, 'node2', 'node4')]}/>);
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-1');
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-2');
    act(() => vi.advanceTimersByTime(600));
    expect(playback()).toHaveTextContent('Trace complete');
    view.rerender(<Topology state={state} message={message} events={[hop(1), hop(2, 'node2', 'node4')]}/>);
    expect(screen.queryByTestId('trace-packet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replay selected trace' }));
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-1');
  });

  it('clears playback when selection, mode, or the trace resets', () => {
    const view = render(<Topology state={state} message={message} events={[hop(1), hop(2)]}/>);
    view.rerender(<Topology state={state} message={undefined} events={[]}/>);
    expect(screen.queryByTestId('trace-packet')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByTestId('trace-packet')).not.toBeInTheDocument();
    view.rerender(<Topology state={{ ...state, mode: 'replay' }} message={message} events={[hop(1)]}/>);
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-1');
    view.rerender(<Topology state={{ ...state, mode: 'replay' }} message={message} events={[]}/>);
    expect(screen.queryByTestId('trace-packet')).not.toBeInTheDocument();
  });

  it('bounds the visual queue and explicitly reports observed hops excluded from animation', () => {
    render(<Topology state={state} message={message} events={Array.from({ length: 300 }, (_, index) => hop(index + 1))}/>);
    expect(playback()).toHaveTextContent('199 hops queued');
    expect(screen.getByText('100 observed hops not animated (presentation limit).')).toBeInTheDocument();
    expect(screen.getByText('Visual timing only · backend timing stays in the ledger.')).toBeInTheDocument();
  });

  it('starts a newly inserted SVG animation without restarting it for incoming queue updates', () => {
    const begin = vi.fn();
    Object.defineProperty(SVGElement.prototype, 'beginElement', { configurable: true, value: begin });
    try {
      const view = render(<Topology state={state} message={message} events={[hop(1)]}/>);
      expect(begin).toHaveBeenCalledTimes(1);
      view.rerender(<Topology state={state} message={message} events={[hop(1), hop(2)]}/>);
      expect(begin).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(600));
      expect(begin).toHaveBeenCalledTimes(2);
    } finally { delete (SVGElement.prototype as unknown as { beginElement?: unknown }).beginElement; }
  });

  it('labels endpoint identities consistently while retaining actual node IDs', () => {
    render(<Topology state={{ ...state, nodes: state.nodes.map(node => ({ ...node, name: node.id === 'node0' ? 'Alice' : node.id === 'node4' ? 'Eve' : node.name })) }} message={message} events={[]}/>);
    expect(screen.getByText('Malcome · Deep playa', { selector: 'text' })).toBeInTheDocument();
    expect(screen.getByText('Basith · Playa airport', { selector: 'text' })).toBeInTheDocument();
    expect(screen.getByText('node0')).toBeInTheDocument();
    expect(screen.getByText('node4')).toBeInTheDocument();
  });

  it('continues playback after StrictMode checks the effect cleanup', () => {
    render(<StrictMode><Topology state={state} message={message} events={[hop(1), hop(2)]}/></StrictMode>);
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-2');
  });
});


describe('live packet synchronization', () => {
  const liveState = { ...state, mode: 'live' as const, config: { ...state.config, bitRate: 1070, playbackSpeed: 2 } };
  const sending = { ...message, status: 'in_transit' as const, integrity: 'unverified' as const, receiptConfirmed: false };
  it('shows the latest active transmission immediately without queuing older hops', () => {
    const view = render(<Topology state={liveState} message={sending} events={[hop(1)]}/>);
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-1');
    view.rerender(<Topology state={liveState} message={sending} events={[hop(1), { ...hop(2), kind: 'packet_rx' }, hop(3, 'node2', 'node4')]}/>);
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-3');
    expect(playback()).not.toHaveTextContent('queued');
    expect(screen.getByText('Live packet activity')).toBeInTheDocument();
    expect(screen.getByTestId('trace-packet').querySelector('[path]')).toHaveAttribute('path', 'M300,242 L418,157');
    expect(screen.getByTestId('trace-packet').querySelector('[path]')).toHaveAttribute('fill', 'freeze');
  });
  it('holds the marker between nodes through a dropped attempt until reception', () => {
    const view = render(<Topology state={liveState} message={sending} events={[hop(1), { ...hop(2), kind: 'packet_dropped' }]}/>);
    expect(screen.getByTestId('trace-packet').querySelector('[path]')).toHaveAttribute('path', 'M64,72 L182,157');
    view.rerender(<Topology state={liveState} message={sending} events={[hop(1), { ...hop(2), kind: 'packet_dropped' }, hop(3), { ...hop(4), kind: 'packet_rx' }]}/>);
    expect(screen.queryByTestId('trace-packet')).not.toBeInTheDocument();
  });
  it('stops the live marker on reception and never replays a delivered snapshot automatically', () => {
    const view = render(<Topology state={liveState} message={sending} events={[hop(1)]}/>);
    view.rerender(<Topology state={liveState} message={sending} events={[hop(1), { ...hop(2), kind: 'packet_rx' }]}/>);
    expect(screen.queryByTestId('trace-packet')).not.toBeInTheDocument();
    view.rerender(<Topology state={liveState} message={message} events={[hop(1), hop(3, 'node2', 'node4')]}/>);
    expect(screen.queryByTestId('trace-packet')).not.toBeInTheDocument();
    expect(playback()).toHaveTextContent('Delivered');
  });
  it('allows explicit replay but returns to live activity when a new event arrives', () => {
    const view = render(<Topology state={liveState} message={sending} events={[hop(1), hop(2)]}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Replay selected trace' }));
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-1');
    view.rerender(<Topology state={liveState} message={sending} events={[hop(1), hop(2), hop(3, 'node2', 'node4')]}/>);
    expect(screen.getByTestId('trace-packet')).toHaveAttribute('data-event-id', 'event-3');
    expect(screen.getByText('Live packet activity')).toBeInTheDocument();
  });
});
