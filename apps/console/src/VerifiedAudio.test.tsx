// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { VerifiedAudio } from './VerifiedAudio';

afterEach(cleanup);
describe('verified browser audio', () => {
  it('offers browser playback controls for the supplied verified media URL', () => {
    render(<VerifiedAudio uri="/api/media/voice-001.wav"/>);
    const player = screen.getByLabelText('Verified voice playback');
    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('src', '/api/media/voice-001.wav');
  });

  it('offers the same verified file as a download if the browser cannot play it', () => {
    render(<VerifiedAudio uri="/api/media/voice-002.wav"/>);
    fireEvent.error(screen.getByLabelText('Verified voice playback'));
    expect(screen.getByRole('alert')).toHaveTextContent('Audio playback unavailable');
    expect(screen.getByRole('link', { name: 'Download verified audio' })).toHaveAttribute('href', '/api/media/voice-002.wav');
  });

  it('does not carry a playback failure into a different verified file', () => {
    const view = render(<VerifiedAudio uri="/api/media/old.wav"/>);
    fireEvent.error(screen.getByLabelText('Verified voice playback'));
    view.rerender(<VerifiedAudio uri="/api/media/new.wav"/>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Verified voice playback')).toHaveAttribute('src', '/api/media/new.wav');
  });
});
