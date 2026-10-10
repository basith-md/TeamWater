import type { MediaAsset } from '@teamwater/core';

export function pickBrowserMedia(kind: 'image' | 'voice'): Promise<MediaAsset | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'image' ? 'image/*' : 'audio/*';
    input.style.display = 'none';
    input.addEventListener('cancel', () => { input.remove(); resolve(null); }, { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ file, name: file.name, type: file.type || 'application/octet-stream', uri: String(reader.result) });
      reader.onerror = () => reject(new Error('The selected file could not be read. Try another file.'));
      reader.readAsDataURL(file);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
