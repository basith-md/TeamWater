// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { MeshClient, MeshMessage, MeshState } from '@teamwater/core';
import { App } from './App';

afterEach(cleanup);

function message(id: string, route: string[]): MeshMessage {
  return { id, src: 'node0', dst: 'node4', kind: 'text', preview: id, text: id,
    totalChunks: 2, received: 0, acked: 0, status: 'in_transit', route,
    createdAt: 0, etaSeconds: null, integrity: 'unverified', receiptConfirmed: false };
}

function makeClient(overrides: Partial<MeshState> = {}): MeshClient {
  let state: MeshState = {
    mode: 'replay', connection: 'connected', endpoint: '/api', scenario: 'clean', error: null,
    nodes: [{ id: 'node0', name: 'Boss', x: 0, y: 0, color: '#ff632d', online: true },
      { id: 'node2', name: 'Relay', x: 120, y: 100, color: '#777', online: true },
      { id: 'node4', name: 'Employee', x: 240, y: 0, color: '#ff632d', online: true }],
    links: [{ from: 'node0', to: 'node2' }, { from: 'node2', to: 'node4' }], messages: {}, events: [],
    config: { bitRate: null, rangeMeters: null, lossRate: null, playbackSpeed: 1 },
    capabilities: { packetEvents: false, controls: false, verifiedContent: false }, ...overrides,
  };
  const listeners = new Set<() => void>();
  const update = (next: Partial<MeshState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    start() {}, dispose() {}, setMode: (mode, endpoint) => update({ mode, endpoint: endpoint ?? state.endpoint }),
    setScenario: scenario => update({ scenario }),
    setPlaybackSpeed: playbackSpeed => update({ config: { ...state.config, playbackSpeed } }),
    reset: () => update({ messages: {}, events: [] }), sendText: async () => 'new-message', sendMedia: async () => 'media-message',
  };
}

describe('mesh console', () => {
  it('shows missing live telemetry as unavailable instead of zero', () => {
    render(<App client={makeClient({ mode: 'live', connection: 'disconnected' })} />);
    for (const name of ['Bandwidth', 'Delay', 'Range', 'Packet loss']) {
      expect(within(screen.getByRole('group', { name })).getByText('Unavailable')).toBeInTheDocument();
    }
    expect(screen.getByText('Packet events unavailable')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('changes replay scenario and speed, and disables both in live mode', () => {
    render(<App client={makeClient()} />);
    const scenario = screen.getByRole('combobox', { name: 'Replay scenario' });
    fireEvent.change(scenario, { target: { value: 'lossy' } });
    expect(scenario).toHaveValue('lossy');
    const speed = screen.getByRole('combobox', { name: 'Playback speed' });
    fireEvent.change(speed, { target: { value: '2' } });
    expect(speed).toHaveValue('2');
    fireEvent.click(screen.getByRole('button', { name: 'Live backend' }));
    expect(scenario).toBeDisabled();
    expect(speed).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset demo' })).toBeDisabled();
    expect(screen.getByText('Backend controls unavailable')).toBeInTheDocument();
  });

  it('filters route and packet events by the inspected message', () => {
    render(<App client={makeClient({
      capabilities: { packetEvents: true, controls: true, verifiedContent: true },
      messages: { alpha: message('alpha', ['node0', 'node2', 'node4']), beta: message('beta', ['node4', 'node2', 'node0']) },
      events: [
        { id: 'a', sequence: 1, at: 1000, messageId: 'alpha', kind: 'packet_tx', from: 'node0', to: 'node2', packetId: 'alpha-01', bytes: 32 },
        { id: 'b', sequence: 2, at: 2000, messageId: 'beta', kind: 'packet_retry', from: 'node4', to: 'node2', packetId: 'beta-01', bytes: 64 },
      ],
    })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect message alpha' }));
    expect(screen.getByLabelText('Selected route')).toHaveTextContent('node0 → node2 → node4');
    const ledger = screen.getByRole('table', { name: 'Packet ledger' });
    expect(within(ledger).getByText('alpha-01')).toBeInTheDocument();
    expect(within(ledger).queryByText('beta-01')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect message beta' }));
    expect(screen.getByLabelText('Selected route')).toHaveTextContent('node4 → node2 → node0');
    expect(within(ledger).getByText('beta-01')).toBeInTheDocument();
  });

  it('resets the selected route and trace together', () => {
    render(<App client={makeClient({ messages: { alpha: message('alpha', ['node0', 'node4']) } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect message alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }));
    expect(screen.getByLabelText('Selected route')).toHaveTextContent('Send a message to trace its route');
    expect(screen.queryByRole('button', { name: 'Inspect message alpha' })).not.toBeInTheDocument();
  });

  it('keeps settings keyboard focus in the dialog and restores it on Escape', () => {
    render(<App client={makeClient()} />);
    const trigger = screen.getByRole('button', { name: 'Connection settings' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('marks packet size unavailable when the backend does not report bytes', () => {
    render(<App client={makeClient({
      capabilities: { packetEvents: true, controls: false, verifiedContent: true },
      messages: { alpha: message('alpha', ['node0', 'node2', 'node4']) },
      events: [{ id: 'unknown-size', sequence: 1, at: 1000, messageId: 'alpha', kind: 'packet_rx', from: 'node0', to: 'node2', packetId: 'alpha-01', bytes: null }],
    })}/>);
    expect(within(screen.getByRole('table', { name: 'Packet ledger' })).getByText('—')).toBeInTheDocument();
  });

  it('makes an actual no-route event visible in the packet ledger', () => {
    render(<App client={makeClient({
      capabilities: { packetEvents: true, controls: false, verifiedContent: true },
      messages: { alpha: message('alpha', []) },
      events: [{ id: 'route-failure', sequence: 1, at: 1000, messageId: 'alpha', kind: 'no_route', from: 'node0', to: 'node4', packetId: 'alpha-01', bytes: null }],
    })}/>);
    expect(within(screen.getByRole('table', { name: 'Packet ledger' })).getByText('No route')).toBeInTheDocument();
  });

  it('shows live event simulation time rather than interpreting it as a wall-clock date', () => {
    render(<App client={makeClient({ mode: 'live',
      capabilities: { packetEvents: true, controls: false, verifiedContent: true },
      messages: { alpha: { ...message('alpha', ['node0', 'node4']), createdAt: 1700000000000 } },
      events: [{ id: 'live-time', sequence: 1, at: 1250, messageId: 'alpha', kind: 'packet_tx', from: 'node0', to: 'node4', packetId: 'alpha-01', bytes: 32 }],
    })}/>);
    const ledger = within(screen.getByRole('table', { name: 'Packet ledger' }));
    expect(ledger.getByRole('columnheader', { name: 'Sim time' })).toBeInTheDocument();
    expect(ledger.getByText('+1.250s')).toBeInTheDocument();
  });

  it('shows replay event elapsed time relative to its selected message', () => {
    render(<App client={makeClient({
      capabilities: { packetEvents: true, controls: true, verifiedContent: true },
      messages: { alpha: { ...message('alpha', ['node0', 'node4']), createdAt: 10000 } },
      events: [{ id: 'replay-time', sequence: 1, at: 12500, messageId: 'alpha', kind: 'packet_tx', from: 'node0', to: 'node4', packetId: 'alpha-01', bytes: 32 }],
    })}/>);
    const ledger = within(screen.getByRole('table', { name: 'Packet ledger' }));
    expect(ledger.getByRole('columnheader', { name: 'Elapsed' })).toBeInTheDocument();
    expect(ledger.getByText('+2.500s')).toBeInTheDocument();
  });

  it('keeps unknown replay timing unavailable', () => {
    render(<App client={makeClient({
      capabilities: { packetEvents: true, controls: true, verifiedContent: true },
      messages: { alpha: { ...message('alpha', ['node0', 'node4']), createdAt: null } },
      events: [{ id: 'unknown-time', sequence: 1, at: 12500, messageId: 'alpha', kind: 'packet_tx', from: 'node0', to: 'node4', packetId: 'alpha-01', bytes: 32 }],
    })}/>);
    expect(within(screen.getByRole('table', { name: 'Packet ledger' })).getByRole('cell', { name: '—' })).toBeInTheDocument();
  });

  it('inspects the latest known-time message ahead of messages with unknown creation time', () => {
    render(<App client={makeClient({ messages: {
      unknown: { ...message('unknown', []), createdAt: null },
      known: { ...message('known', ['node0', 'node4']), createdAt: 0 },
    } })}/>);
    expect(screen.getByLabelText('Selected route')).toHaveTextContent('node0 → node4');
    expect(screen.getByRole('button', { name: 'Inspect message known' })).toHaveAttribute('aria-pressed', 'true');
  });
});
