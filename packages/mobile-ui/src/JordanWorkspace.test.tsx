import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMeshClient } from '@teamwater/core';
import { JordanWorkspace } from './JordanWorkspace';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('switches Jordan between Chat and Code without losing either draft', () => {
  const client = createMeshClient({ mode: 'replay' });
  render(<JordanWorkspace client={client} embedded workflow={{ kind: 'prototype', phase: 'request', connection: 'not_connected' }} onSubmit={async () => {}}/>);
  fireEvent.change(screen.getByLabelText('Message input'), { target: { value: 'Working on the discount' } });
  fireEvent.click(screen.getByLabelText('Open Jordan menu'));
  fireEvent.click(screen.getByRole('button', { name: 'Code' }));
  expect(screen.getByLabelText('Current workspace').textContent).toBe('Code');
  expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Problem summary'), { target: { value: 'Apply a percentage, not cents' } });
  fireEvent.click(screen.getByLabelText('Open Jordan menu'));
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
  expect((screen.getByLabelText('Message input') as HTMLTextAreaElement).value).toBe('Working on the discount');
  expect(screen.queryByRole('button', { name: 'Submit problem summary' })).toBeNull();
  fireEvent.click(screen.getByLabelText('Open Jordan menu'));
  fireEvent.click(screen.getByRole('button', { name: 'Code' }));
  expect((screen.getByLabelText('Problem summary') as HTMLTextAreaElement).value).toBe('Apply a percentage, not cents');
  client.dispose();
});

it('unmounts the live recorder while Code is open so hidden Chat cannot record', () => {
  let disposals = 0;
  function Recorder() {
    useEffect(() => () => { disposals++; }, []);
    return <Text>Recorder visible</Text>;
  }
  const client = createMeshClient({ mode: 'live' });
  render(<JordanWorkspace client={client} embedded workflow={{ kind: 'prototype', phase: 'request', connection: 'not_connected' }} onSubmit={async () => {}} renderVoiceRecorder={() => <Recorder/>}/>);
  expect(screen.getByText('Recorder visible')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Open Jordan menu'));
  fireEvent.click(screen.getByRole('button', { name: 'Code' }));
  expect(screen.queryByText('Recorder visible')).toBeNull();
  expect(disposals).toBe(1);
  client.dispose();
});

it('sends a completed deployed app URL from Jordan to Alex through the actual mesh transport', async () => {
  let posted: FormData | undefined;
  vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => {
    posted = options.body as FormData;
    return new Response(JSON.stringify({ msg_id: 'result-link', chunks: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const client = createMeshClient({ mode: 'live', endpoint: 'https://mesh.test' });
  render(<JordanWorkspace client={client} embedded workflow={{ kind: 'prototype', phase: 'complete', connection: 'connected', result: { kind: 'prototype', url: 'https://example.com/camp' } }} onSubmit={async () => {}}/>);
  fireEvent.click(screen.getByLabelText('Open Jordan menu'));
  fireEvent.click(screen.getByRole('button', { name: 'Code' }));
  fireEvent.click(screen.getByLabelText('Send link to Alex'));
  await waitFor(() => expect(posted?.get('text')).toContain('https://example.com/camp'));
  expect(posted?.get('src')).toBe('node4');
  expect(posted?.get('dst')).toBe('node0');
  await screen.findByText('Link queued for Alex through the mesh.');
  client.dispose();
});
