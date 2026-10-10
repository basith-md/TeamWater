// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { MeshClient, MeshMessage, MeshState } from '@teamwater/core';
import { App } from './App';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function message(id: string, route: string[]): MeshMessage {
  return { id, src: 'node0', dst: 'node4', kind: 'text', preview: id, text: id,
    totalChunks: 2, received: 0, acked: 0, status: 'in_transit', route,
    createdAt: 0, etaSeconds: null, integrity: 'unverified', receiptConfirmed: false };
}

function makeClient(overrides: Partial<MeshState> = {}): MeshClient & { publish: (next: Partial<MeshState>) => void } {
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
    publish: update,
    getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    start() {}, dispose() {}, setMode: (mode, endpoint) => update({ mode, endpoint: endpoint ?? state.endpoint }),
    setScenario: scenario => update({ scenario }),
    setPlaybackSpeed: playbackSpeed => update({ config: { ...state.config, playbackSpeed } }),
    reset: () => update({ messages: {}, events: [] }),
    resetConversation: async () => update({ messages: {}, events: [] }),
    sendText: async (src, dst, text) => {
      const id = `message-${Object.keys(state.messages).length + 1}`;
      const route = src === 'node0' ? ['node0', 'node2', 'node4'] : ['node4', 'node2', 'node0'];
      const sequence = state.events.length + 1;
      update({ messages: { ...state.messages, [id]: { ...message(id, route), src, dst, text, preview: text, createdAt: sequence,
        received: 2, acked: 2, integrity: 'verified', receiptConfirmed: true, status: 'delivered' } },
        events: [...state.events, { id: `${id}-tx`, sequence, at: sequence, messageId: id,
          kind: 'packet_tx', from: route[0], to: route[1], packetId: `${id}-packet`, bytes: 32 }] });
      return id;
    }, sendMedia: async () => 'media-message',
  };
}

describe('mesh console', () => {
  it('plays visible 70ms typing in both composers and waits for each verified receipt', async () => {
    vi.useFakeTimers();
    const invitation = 'Basith, come meet me at the Mayan Warrior set in deep playa!';
    const reply = 'On my way from the playa airport, Malcome. See you at Mayan Warrior!';
    const client = makeClient({ mode: 'live', messages: { old: message('old', ['node0', 'node4']) } });
    const sent: { src: string; dst: string; text: string; id: string }[] = [];
    client.sendText = async (src, dst, text) => {
      const id = `demo-${sent.length + 1}`;
      sent.push({ src, dst, text, id });
      client.publish({ messages: { ...client.getSnapshot().messages, [id]: { ...message(id, [src, dst]), src, dst, text, preview: text, status: 'sending' } } });
      return id;
    };
    render(<App client={client}/>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play demo' })));
    const left = within(screen.getByTestId('phone-boss'));
    const right = within(screen.getByTestId('phone-employee'));
    expect(client.getSnapshot().messages.old).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Play demo' })).toBeDisabled();
    expect(left.getByLabelText('Send message')).toHaveAttribute('aria-disabled', 'true');
    expect(right.getByLabelText('Record voice')).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(69));
    expect(left.getByLabelText('Message input')).toHaveValue('');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(left.getByLabelText('Message input')).toHaveValue('B');
    await act(async () => vi.advanceTimersByTimeAsync(70 * (invitation.length - 1)));
    expect(sent).toEqual([{ src: 'node0', dst: 'node4', text: invitation, id: 'demo-1' }]);
    const confirm = (id: string, receiptConfirmed: boolean) => client.publish({ messages: { ...client.getSnapshot().messages, [id]: { ...client.getSnapshot().messages[id], received: 2, acked: 2, integrity: 'verified', receiptConfirmed, status: receiptConfirmed ? 'delivered' : 'awaiting_receipt' } } });
    act(() => confirm('demo-1', false));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(right.getByLabelText('Message input')).toHaveValue('');
    expect(sent).toHaveLength(1);
    act(() => confirm('demo-1', true));
    await act(async () => vi.advanceTimersByTimeAsync(70));
    expect(right.getByLabelText('Message input')).toHaveValue('O');
    await act(async () => vi.advanceTimersByTimeAsync(70 * (reply.length - 1)));
    expect(sent[1]).toEqual({ src: 'node4', dst: 'node0', text: reply, id: 'demo-2' });
    await act(async () => confirm('demo-2', true));
    expect(screen.getByRole('status', { name: 'Demo playback' })).toHaveTextContent('Demo complete');
    expect(screen.getByRole('button', { name: 'Play demo' })).toBeEnabled();
    expect(left.getByText(invitation, { exact: true })).toBeVisible();
    expect(right.getByText(reply, { exact: true })).toBeVisible();
    expect(left.getByLabelText('Message input')).toHaveValue('');
    expect(right.getByLabelText('Message input')).toHaveValue('');
  });

  it('cancels the typing rehearsal when Reset demo is pressed', async () => {
    vi.useFakeTimers();
    const client = makeClient({ mode: 'live' });
    client.sendText = vi.fn(client.sendText);
    render(<App client={client}/>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play demo' })));
    await act(async () => vi.advanceTimersByTimeAsync(140));
    expect(within(screen.getByTestId('phone-boss')).getByLabelText('Message input')).toHaveValue('Ba');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reset demo' })));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(client.getSnapshot().messages).toEqual({});
    expect(within(screen.getByTestId('phone-boss')).getByLabelText('Message input')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Play demo' })).toBeEnabled();
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it.each([
    { connection: 'disconnected' as const },
    { mode: 'replay' as const },
    { endpoint: 'https://other.example/api' },
  ])('stops before sending when the active simulator changes during typing: %o', async change => {
    vi.useFakeTimers();
    const client = makeClient({ mode: 'live' });
    client.sendText = vi.fn(client.sendText);
    render(<App client={client}/>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play demo' })));
    await act(async () => vi.advanceTimersByTimeAsync(140));
    await act(async () => client.publish(change));
    expect(screen.getByRole('alert')).toHaveTextContent('Demo stopped: Simulator connection changed');
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(client.sendText).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('phone-boss')).getByLabelText('Message input')).not.toHaveAttribute('readonly');
  });

  it('stops the demo with an actionable reset error instead of sending into the old conversation', async () => {
    const client = makeClient({ mode: 'live' });
    client.resetConversation = async () => { throw new Error('Simulator is unavailable'); };
    render(<App client={client}/>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play demo' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Demo stopped: Simulator is unavailable');
    expect(client.getSnapshot().messages).toEqual({});
    expect(screen.getByRole('button', { name: 'Play demo' })).toBeEnabled();
  });

  it('clears both histories, the ledger, selected route and drafts after a successful reset', async () => {
    const client = makeClient({ mode: 'live', messages: { alpha: { ...message('alpha', ['node0', 'node2', 'node4']), received: 2, integrity: 'verified' } },
      events: [{ id: 'alpha-tx', sequence: 1, at: 100, messageId: 'alpha', kind: 'packet_tx', from: 'node0', to: 'node2', packetId: 'alpha-01', bytes: 32 }] });
    const nodes = client.getSnapshot().nodes;
    render(<App client={client}/>);
    const inputs = screen.getAllByRole('textbox', { name: 'Message input' });
    fireEvent.change(inputs[0], { target: { value: 'Old draft' } });
    fireEvent.change(inputs[1], { target: { value: 'Old reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Inspect message alpha' })).not.toBeInTheDocument());
    for (const input of screen.getAllByRole('textbox', { name: 'Message input' })) expect(input).toHaveValue('');
    expect(screen.getByRole('status', { name: 'Selected message' })).toHaveTextContent('No message selected');
    expect(screen.getByLabelText('Selected route')).toHaveTextContent('Send a message to trace its route');
    expect(screen.getByRole('table', { name: 'Packet ledger' })).not.toHaveTextContent('alpha-01');
    expect(client.getSnapshot().nodes).toEqual(nodes);
  });

  it('retains the current conversation and drafts when reset fails', async () => {
    const client = makeClient({ mode: 'live', messages: { alpha: message('alpha', ['node0', 'node4']) } });
    client.resetConversation = vi.fn().mockRejectedValue(new Error('Reset unavailable'));
    render(<App client={client}/>);
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Message input' })[0], { target: { value: 'Keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reset unavailable');
    expect(screen.getAllByRole('textbox', { name: 'Message input' })[0]).toHaveValue('Keep my draft');
    expect(screen.getByRole('button', { name: 'Inspect message alpha' })).toBeInTheDocument();
  });
  it('shows selected message verification without claiming a cryptographic signature', () => {
    render(<App client={makeClient({ mode: 'live', messages: { alpha: {
      ...message('alpha', ['node0', 'node2', 'node4']), status: 'delivered', received: 2,
      integrity: 'verified', receiptConfirmed: true,
    } } })}/>);
    const summary = screen.getByRole('status', { name: 'Selected message' });
    expect(summary).toHaveTextContent('Delivered · verified by receiver');
    expect(summary).not.toHaveTextContent(/signed|only now/i);
  });

  it('shows receipt-unconfirmed delivery accurately despite receiver verification', () => {
    const delivered = { ...message('alpha', ['node0', 'node4']), integrity: 'verified' as const, status: 'receipt_unconfirmed' as const, received: 2 };
    const view = render(<App client={makeClient({ mode: 'live', messages: { alpha: delivered } })}/>);
    expect(screen.getByRole('status', { name: 'Selected message' })).toHaveTextContent('Delivery unconfirmed · receiver verified');
    view.unmount();
    render(<App client={makeClient({ mode: 'live', messages: { alpha: message('alpha', ['node0', 'node4']) } })}/>);
    expect(screen.getByRole('status', { name: 'Selected message' })).toHaveTextContent('In transit');
  });

  it('does not claim a failed transfer means the receiver never reconstructed content', () => {
    render(<App client={makeClient({ mode: 'live', messages: { alpha: {
      ...message('alpha', ['node0', 'node4']), status: 'failed', received: 2, integrity: 'verified',
    } } })}/>);
    const summary = screen.getByRole('status', { name: 'Selected message' });
    expect(summary).toHaveTextContent('Failed');
    expect(summary).not.toHaveTextContent(/shows nothing|never had the full message/i);
  });

  it('does not claim sender confirmation without a confirmed receipt', () => {
    render(<App client={makeClient({ mode: 'live', messages: { alpha: {
      ...message('alpha', ['node0', 'node4']), status: 'delivered', received: 2, integrity: 'verified', receiptConfirmed: false,
    } } })}/>);
    expect(screen.getByRole('status', { name: 'Selected message' })).toHaveTextContent('Receiver verified · awaiting receipt');
  });

  it('starts the default and newly chosen pair with empty composers', () => {
    render(<App client={makeClient({ mode: 'live' })}/>);
    expect(screen.getByRole('combobox', { name: 'Left phone node' })).toHaveTextContent('Malcome');
    expect(screen.getByRole('combobox', { name: 'Right phone node' })).toHaveTextContent('Basith');
    fireEvent.click(screen.getByRole('combobox', { name: 'Right phone node' }));
    fireEvent.click(screen.getByRole('option', { name: 'Lucas (node2)' }));
    expect(within(screen.getByTestId('phone-boss')).getByRole('textbox', { name: 'Message input' })).toHaveValue('');
    expect(within(screen.getByTestId('phone-employee')).getByRole('textbox', { name: 'Message input' })).toHaveValue('');
  });

  it('anchors the phone menu to its trigger and closes on Escape or an outside press', () => {
    render(<App client={makeClient({ mode: 'live' })}/>);
    const trigger = screen.getByRole('combobox', { name: 'Right phone node' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('listbox', { name: 'Right phone node options' });
    expect(menu.parentElement).toHaveClass('phone-node-picker');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('option', { name: 'Malcome (node0)' })).toBeDisabled();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reports route verification from proof data without inventing a Dijkstra check', () => {
    render(<App client={makeClient({ mode: 'live', routing: { distanceAware: true, links: [] }, messages: { alpha: {
      ...message('alpha', ['node0', 'node4']), routeProof: { metric: 'etx', chosen: ['node0', 'node4'],
        chosenCost: 2, chosenDistance: 140, candidatesChecked: 1, verifiedBy: ['enumeration'], optimal: true, links: [], alternatives: [] },
    } } })}/>);
    expect(screen.getByLabelText('Route proof')).not.toHaveTextContent('Dijkstra');
    expect(screen.getByLabelText('Route proof')).toHaveTextContent('enumeration');
  });

  it('introduces the local playa conversation and named relays without workplace identities', () => {
    const client = makeClient();
    const nodes = client.getSnapshot().nodes;
    render(<App client={makeClient({ nodes: [...nodes, { id: 'node1', name: 'Bob', x: 60, y: 60, color: '#777', online: true }] })}/>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Message Your People At Burning Man Without Cell Service');
    const map = within(screen.getByRole('img', { name: 'Mesh network topology' }));
    for (const label of ['Malcome · Deep playa', 'Basith · Playa airport', 'Lucas · Relay', 'Shravanthi · Relay']) {
      expect(map.getByText(label, { selector: 'text' })).toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(/Jordan|Alex|San Francisco|The boss|Base camp/);
  });

  it('places both profiles outside the phones and the shared conversation above the mesh', () => {
    render(<App client={makeClient({ mode: 'live' })}/>);
    const phone = screen.getByTestId('phone-boss');
    expect(within(phone).queryByText('/ User 2')).not.toBeInTheDocument();
    expect(within(phone).queryByText('Malcome → Basith')).not.toBeInTheDocument();
    const profile = screen.getByRole('group', { name: 'Malcome profile' });
    expect(profile).toHaveTextContent('Malcome');
    expect(profile).toHaveTextContent('Deep Playa · Mayan Warrior');
    expect(profile).toHaveTextContent('NODE0');
    expect(phone.contains(profile)).toBe(false);
    const receiver = screen.getByTestId('phone-employee');
    expect(within(receiver).queryByText('/ User 1')).not.toBeInTheDocument();
    expect(within(receiver).queryByText('Basith → Malcome')).not.toBeInTheDocument();
    const receiverProfile = screen.getByRole('group', { name: 'Basith profile' });
    expect(receiverProfile).toHaveTextContent('Basith');
    expect(receiverProfile).toHaveTextContent('Playa airport');
    expect(receiverProfile).toHaveTextContent('NODE4');
    expect(receiver.contains(receiverProfile)).toBe(false);
    const network = screen.getByRole('region', { name: 'Network console' });
    expect(within(network).getByRole('heading', { name: 'Malcome → Basith' })).toBeInTheDocument();
    expect(within(phone).getByRole('textbox', { name: 'Message input' })).toHaveValue('');
  });

  it('shows the other Burning Man people by their backend names and actual online status', () => {
    const nodes = makeClient().getSnapshot().nodes;
    render(<App client={makeClient({ nodes: [...nodes,
      { id: 'node3', name: 'Dave', x: 120, y: 140, color: '#777', online: true },
      { id: 'node5', name: 'Frank', x: 180, y: 140, color: '#777', online: true },
    ] })}/>);
    const map = within(screen.getByRole('img', { name: 'Mesh network topology' }));
    expect(map.getByText('Dave · Relay', { selector: 'text' })).toBeInTheDocument();
    expect(map.getByText('Frank · Relay', { selector: 'text' })).toBeInTheDocument();
    expect(screen.getByText('5 / 5 nodes online')).toBeInTheDocument();
    expect(document.querySelectorAll('.map-node.offline')).toHaveLength(0);
  });

  it('sends the invitation and reply with their actual opposing node identities and observed routes', async () => {
    const client = makeClient({ capabilities: { packetEvents: true, controls: true, verifiedContent: true } });
    render(<App client={client}/>);
    const sender = within(screen.getByTestId('phone-boss'));
    const receiver = within(screen.getByTestId('phone-employee'));
    const invitation = 'Basith, come meet me at the Mayan Warrior set in deep playa!';
    const reply = 'On my way from the playa airport. See you at Mayan Warrior!';
    fireEvent.change(sender.getByRole('textbox', { name: 'Message input' }), { target: { value: invitation } });
    fireEvent.change(receiver.getByRole('textbox', { name: 'Message input' }), { target: { value: reply } });
    fireEvent.click(sender.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(receiver.getByText(invitation)).toBeInTheDocument());
    expect(client.getSnapshot().messages['message-1']).toMatchObject({ src: 'node0', dst: 'node4', text: invitation });
    expect(screen.getByLabelText('Selected route')).toHaveTextContent('node0 → node2 → node4');
    fireEvent.click(receiver.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(sender.getByText(reply)).toBeInTheDocument());
    expect(client.getSnapshot().messages['message-2']).toMatchObject({ src: 'node4', dst: 'node0', text: reply });
    expect(screen.getByLabelText('Selected route')).toHaveTextContent('node4 → node2 → node0');
    expect(within(screen.getByRole('table', { name: 'Packet ledger' })).getByText('message-2-packet')).toBeInTheDocument();
  });

  it('explains the configurable simulator proxy without assuming a backend port', () => {
    render(<App client={makeClient()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Connection settings' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('/api uses the configured local simulator proxy.');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('8000');
  });

  it('shows missing live telemetry as unavailable instead of zero', () => {
    render(<App client={makeClient({ mode: 'live', connection: 'disconnected' })} />);
    for (const name of ['Bandwidth', 'Delay', 'Range', 'Packet loss']) {
      expect(within(screen.getByRole('group', { name })).getByText('Unavailable')).toBeInTheDocument();
    }
    expect(screen.getByText('Packet events unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('Disconnected').length).toBeGreaterThan(0);
  });

  it('shows a single live simulation status without source or sample controls', () => {
    render(<App client={makeClient({ mode: 'live' })} />);
    const status = screen.getByRole('status', { name: 'Simulation status' });
    expect(status).toHaveTextContent('Live simulation');
    expect(status).toHaveTextContent('Connected');
    expect(screen.queryByRole('button', { name: 'Sample replay' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Live simulation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Replay scenario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Playback speed' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset demo' })).toBeInTheDocument();
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

  it('keeps replay of actual observed packet traces available', () => {
    render(<App client={makeClient({ mode: 'live',
      messages: { alpha: message('alpha', ['node0', 'node2', 'node4']) },
      events: [{ id: 'observed-tx', sequence: 1, at: 1000, messageId: 'alpha', kind: 'packet_tx', from: 'node0', to: 'node2', packetId: 'alpha-01', bytes: 32 }],
    })}/>);
    expect(screen.getByRole('button', { name: 'Replay selected trace' })).toBeEnabled();
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
