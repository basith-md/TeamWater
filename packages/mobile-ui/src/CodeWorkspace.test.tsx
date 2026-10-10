import React, { useState } from 'react';
import { Linking } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeWorkspace, WorkspaceNavigation, type CodeWorkflowState } from './CodeWorkspace';

afterEach(cleanup);
const idle: CodeWorkflowState = { kind: 'prototype', phase: 'request', connection: 'not_connected' };
const connected: CodeWorkflowState = { ...idle, connection: 'connected', agentName: 'Ninoo' };

describe('CodeWorkspace', () => {
  it('starts with the prototype brief without inventing execution or a deployed link', () => {
    render(<CodeWorkspace workflow={idle} onSubmit={async () => {}}/>);
    expect(screen.getByText('Camp task & supply tracker')).toBeTruthy();
    expect(screen.getByText('Can I see a draft of the prototype a week early?')).toBeTruthy();
    expect(screen.getByText('Agent execution is not connected yet.')).toBeTruthy();
    expect(screen.getByLabelText('Submit problem summary').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByLabelText('Send link to Alex')).toBeNull();
  });

  it('lets Jordan choose the isolated TypeScript bug fix as the secondary workflow', () => {
    render(<CodeWorkspace workflow={idle} onSubmit={async () => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Fix a bug' }));
    expect(screen.getByText('Discounted cart total')).toBeTruthy();
    expect(screen.getByText(/function calculateTotal/)).toBeTruthy();
    expect(screen.getByText(/90.00/)).toBeTruthy();
    expect(screen.getByText('Expected behavior · reference cases')).toBeTruthy();
    expect(screen.queryByText('Camp task & supply tracker')).toBeNull();
  });

  it('submits the manual brief with its kind and waits for supplied progress', async () => {
    let submitted: unknown;
    render(<CodeWorkspace workflow={connected} onSubmit={async request => { submitted = request; }}/>);
    fireEvent.change(screen.getByLabelText('Problem summary'), { target: { value: '  Build a camp supply tracker without accounts.  ' } });
    fireEvent.click(screen.getByLabelText('Submit problem summary'));
    await waitFor(() => expect(submitted).toEqual({ kind: 'prototype', summary: 'Build a camp supply tracker without accounts.' }));
    expect(screen.getByLabelText('Workflow status').textContent).toBe('Request');
    expect(screen.getByText('Summary submitted. Waiting for agent activity.')).toBeTruthy();
    expect(screen.queryByLabelText('Send link to Alex')).toBeNull();
  });

  it('keeps separate summaries for prototype and bug fix', () => {
    render(<CodeWorkspace workflow={connected} onSubmit={async () => {}}/>);
    fireEvent.change(screen.getByLabelText('Problem summary'), { target: { value: 'Build a camp tracker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fix a bug' }));
    fireEvent.change(screen.getByLabelText('Problem summary'), { target: { value: 'Apply percentage, not cents' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build a prototype' }));
    expect((screen.getByLabelText('Problem summary') as HTMLTextAreaElement).value).toBe('Build a camp tracker');
    fireEvent.click(screen.getByRole('button', { name: 'Fix a bug' }));
    expect((screen.getByLabelText('Problem summary') as HTMLTextAreaElement).value).toBe('Apply percentage, not cents');
  });

  it('keeps the draft when submission fails and allows retry', async () => {
    let failing = true;
    render(<CodeWorkspace workflow={connected} onSubmit={async () => { if (failing) throw new Error('Agent gateway unavailable'); }}/>);
    fireEvent.change(screen.getByLabelText('Problem summary'), { target: { value: 'Build the early draft' } });
    fireEvent.click(screen.getByLabelText('Submit problem summary'));
    await screen.findByText('Agent gateway unavailable');
    expect((screen.getByLabelText('Problem summary') as HTMLTextAreaElement).value).toBe('Build the early draft');
    failing = false;
    await waitFor(() => expect(screen.getByLabelText('Submit problem summary').getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(screen.getByLabelText('Submit problem summary'));
    await screen.findByText('Summary submitted. Waiting for agent activity.');
    expect(screen.queryByText('Agent gateway unavailable')).toBeNull();
  });

  it('blocks blank summaries and duplicate submission while pending', async () => {
    let resolve!: () => void;
    let submissions = 0;
    render(<CodeWorkspace workflow={connected} onSubmit={async () => { submissions++; await new Promise<void>(done => { resolve = done; }); }}/>);
    expect(screen.getByLabelText('Submit problem summary').getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Problem summary'), { target: { value: 'Build tracker' } });
    fireEvent.click(screen.getByLabelText('Submit problem summary'));
    fireEvent.click(screen.getByLabelText('Submit problem summary'));
    expect(submissions).toBe(1);
    expect(screen.getByLabelText('Submit problem summary').getAttribute('aria-disabled')).toBe('true');
    await act(async () => resolve());
  });

  it('renders observed bugfix activity, test output, diff and PR from supplied data', async () => {
    const open = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const workflow: CodeWorkflowState = {
      ...connected, kind: 'bugfix', phase: 'complete', activity: [{ id: 'a1', text: 'Read cart.ts', time: '12:04' }],
      tests: [{ label: 'vitest cart.test.ts', status: 'passed', output: '3 passed', url: 'https://example.com/test-run' }],
      diff: { text: '- return subtotalCents - discountPercent;\n+ return Math.round(subtotalCents * (1 - discountPercent / 100));', url: 'https://example.com/diff' },
      result: { kind: 'bugfix', title: 'Fix percentage discount', url: 'https://example.com/pull/7' }
    };
    render(<CodeWorkspace workflow={workflow} onSubmit={async () => {}}/>);
    expect(screen.getByText('Read cart.ts')).toBeTruthy();
    expect(screen.getByText('3 passed')).toBeTruthy();
    expect(screen.getByText(/return Math.round/)).toBeTruthy();
    expect(screen.getByLabelText('Workflow status').textContent).toBe('PR ready');
    fireEvent.click(screen.getByRole('link', { name: 'Open pull request' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.com/pull/7'));
    expect(screen.getByRole('link', { name: 'Open test run' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open diff' })).toBeTruthy();
  });

  it('offers a completed deployed prototype link to Alex only after actual completion', async () => {
    let sent: unknown;
    const result = { kind: 'prototype' as const, title: 'Camp tracker draft', url: 'https://example.com/camp' };
    const view = render(<CodeWorkspace workflow={{ ...connected, phase: 'publishing', result }} onSubmit={async () => {}} onSendLink={async item => { sent = item; }}/>);
    expect(screen.getByLabelText('Workflow status').textContent).toBe('Publishing');
    expect(screen.queryByLabelText('Send link to Alex')).toBeNull();
    view.rerender(<CodeWorkspace workflow={{ ...connected, phase: 'complete', result }} onSubmit={async () => {}} onSendLink={async item => { sent = item; }}/>);
    expect(screen.getByLabelText('Workflow status').textContent).toBe('Deployed');
    expect(screen.queryByText('Prototype brief · not built yet')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open deployed prototype' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Send link to Alex'));
    await waitFor(() => expect(sent).toEqual(result));
    await screen.findByText('Link queued for Alex through the mesh.');
  });

  it('retains a completed result when sending its link fails', async () => {
    const result = { kind: 'prototype' as const, url: 'https://example.com/camp' };
    render(<CodeWorkspace workflow={{ ...connected, phase: 'complete', result }} onSubmit={async () => {}} onSendLink={async () => { throw new Error('Mesh disconnected'); }}/>);
    fireEvent.click(screen.getByLabelText('Send link to Alex'));
    await screen.findByText('Mesh disconnected');
    expect(screen.getByRole('link', { name: 'Open deployed prototype' })).toBeTruthy();
    expect(screen.queryByText('Link queued for Alex through the mesh.')).toBeNull();
  });

  it('does not present agent work as tests or PR completion', () => {
    render(<CodeWorkspace workflow={{ ...connected, kind: 'bugfix', phase: 'agent_working', activity: [{ id: 'a2', text: 'Inspecting the discount calculation' }] }} onSubmit={async () => {}}/>);
    expect(screen.getByLabelText('Workflow status').textContent).toBe('Agent working');
    expect(screen.getByText('Inspecting the discount calculation')).toBeTruthy();
    expect(screen.getByText('No test results reported yet.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open pull request' })).toBeNull();
  });

  it('does not apply an old submission completion after the agent connection changes', async () => {
    let resolve!: () => void;
    const submit = async () => new Promise<void>(done => { resolve = done; });
    const view = render(<CodeWorkspace workflow={connected} onSubmit={submit}/>);
    fireEvent.change(screen.getByLabelText('Problem summary'), { target: { value: 'Build camp tracker' } });
    fireEvent.click(screen.getByLabelText('Submit problem summary'));
    view.rerender(<CodeWorkspace workflow={idle} onSubmit={submit}/>);
    await act(async () => resolve());
    expect(screen.queryByText('Summary submitted. Waiting for agent activity.')).toBeNull();
  });

  it('does not apply an old link-send completion to a different result', async () => {
    let resolve!: () => void;
    const send = async () => new Promise<void>(done => { resolve = done; });
    const view = render(<CodeWorkspace workflow={{ ...connected, phase: 'complete', result: { kind: 'prototype', url: 'https://example.com/first' } }} onSubmit={async () => {}} onSendLink={send}/>);
    fireEvent.click(screen.getByLabelText('Send link to Alex'));
    view.rerender(<CodeWorkspace workflow={{ ...connected, phase: 'complete', result: { kind: 'prototype', url: 'https://example.com/second' } }} onSubmit={async () => {}} onSendLink={send}/>);
    await act(async () => resolve());
    expect(screen.queryByText('Link queued for Alex through the mesh.')).toBeNull();
  });

  it('exposes the actual provider project only when its URL is supplied', async () => {
    const open = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    render(<CodeWorkspace workflow={{ ...connected, projectUrl: 'https://example.com/project' }} onSubmit={async () => {}}/>);
    fireEvent.click(screen.getByRole('link', { name: 'Open agent project' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.com/project'));
  });
});

describe('WorkspaceNavigation', () => {
  it('opens a left menu, changes between Chat and Code, and closes after selection', () => {
    function Navigation() {
      const [view, setView] = useState<'chat' | 'code'>('chat');
      return <WorkspaceNavigation view={view} onNavigate={setView}/>;
    }
    render(<Navigation/>);
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Open Jordan menu'));
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(screen.getByLabelText('Current workspace').textContent).toBe('Code');
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Open Jordan menu'));
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(screen.getByLabelText('Current workspace').textContent).toBe('Chat');
  });
});
