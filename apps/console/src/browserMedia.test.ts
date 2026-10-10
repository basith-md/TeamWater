// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { pickBrowserMedia } from './browserMedia';

describe('browser attachment selection', () => {
  it('returns the actual selected image file with its media type and readable URI', async () => {
    const selection = pickBrowserMedia('image');
    const input = document.querySelector<HTMLInputElement>('input[type=file]');
    expect(input).not.toBeNull();
    expect(input).toHaveProperty('accept', 'image/*');
    const file = new File(['pixels'], 'playa.jpg', { type: 'image/jpeg' });
    fireEvent.change(input!, { target: { files: [file] } });
    const asset = await selection;
    expect(asset?.file).toBe(file);
    expect(asset?.name).toBe('playa.jpg');
    expect(asset?.type).toBe('image/jpeg');
    expect(asset?.uri).toBe('data:image/jpeg;base64,cGl4ZWxz');
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('limits voice selection to audio files and removes the picker on cancellation', async () => {
    const selection = pickBrowserMedia('voice');
    const input = document.querySelector<HTMLInputElement>('input[type=file]');
    expect(input).not.toBeNull();
    expect(input).toHaveProperty('accept', 'audio/*');
    fireEvent(input!, new Event('cancel'));
    expect(await selection).toBeNull();
    expect(document.querySelector('input[type=file]')).toBeNull();
  });
});
