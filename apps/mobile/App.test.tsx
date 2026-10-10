import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('expo-document-picker', () => ({ getDocumentAsync: async () => ({ canceled: true, assets: null }) }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}) }));
afterEach(cleanup);

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
  expect(screen.getByText('Demo replay · authored sample')).toBeTruthy();
});
