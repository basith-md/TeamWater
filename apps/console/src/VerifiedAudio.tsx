import { useState } from 'react';

export function VerifiedAudio({ uri }: { uri: string }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return <div className="verified-audio">
    <audio key={uri} aria-label="Verified voice playback" controls preload="metadata" src={uri} onError={() => setFailedUri(uri)}/>
    {failedUri === uri && <p role="alert">Audio playback unavailable. <a href={uri} download>Download verified audio</a></p>}
  </div>;
}
