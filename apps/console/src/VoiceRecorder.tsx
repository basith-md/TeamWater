import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Send } from 'lucide-react';
import type { MediaAsset } from '@teamwater/core';
import type { VoiceRecorderProps } from '@teamwater/mobile-ui';

interface Capture { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; canceled: boolean; released: boolean; token: number }
type Phase = 'idle' | 'requesting' | 'recording' | 'preparing' | 'preview' | 'sending';

export function VoiceRecorder({ onSend, disabled }: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true), generation = useRef(0), pending = useRef(false), sending = useRef(false);
  const capture = useRef<Capture | null>(null), clip = useRef<MediaAsset | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null), limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (ticker.current !== null) clearInterval(ticker.current);
    if (limit.current !== null) clearTimeout(limit.current);
    ticker.current = null; limit.current = null;
  };
  const release = (run: Capture) => { if (!run.released) { run.released = true; run.stream.getTracks().forEach(track => track.stop()); } };
  const releaseClip = () => { if (clip.current) URL.revokeObjectURL(clip.current.uri); clip.current = null; };
  const cancel = (reason?: string) => {
    generation.current++; pending.current = false; clearTimers();
    const run = capture.current;
    capture.current = null;
    if (run) {
      run.canceled = true;
      try { if (run.recorder.state !== 'inactive') run.recorder.stop(); } catch { /* Tracks still close if the recorder has already stopped. */ } finally { release(run); }
    }
    if (mounted.current) { setPhase(clip.current ? 'preview' : 'idle'); if (reason) setError(reason); }
  };
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.visibilityState === 'hidden' && (capture.current || pending.current)) cancel('Recording canceled when the tab was hidden.'); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', hidden); cancel(); releaseClip(); };
  }, []);
  useEffect(() => { if (disabled && (capture.current || pending.current)) cancel('Recording canceled while another message is sending.'); }, [disabled]);

  const stop = () => {
    const run = capture.current;
    if (!run) return;
    clearTimers(); setPhase('preparing');
    try { if (run.recorder.state !== 'inactive') run.recorder.stop(); }
    catch { cancel('Recording could not finish. Try recording again.'); }
    finally { release(run); }
  };

  async function start() {
    if (disabled || pending.current || capture.current || sending.current) return;
    setError(null);
    if (globalThis.isSecureContext === false) { setError('Microphone recording needs HTTPS or localhost. Open the console on a secure address.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Microphone recording is unavailable in this browser. Use a supported browser or attach an audio file.'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) { setError('This browser cannot record a supported audio format. Attach an audio file instead.'); return; }
    const token = ++generation.current;
    pending.current = true; setPhase('requesting');
    let acquired: MediaStream | null = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || token !== generation.current || document.visibilityState === 'hidden') { acquired.getTracks().forEach(track => track.stop()); return; }
      pending.current = false;
      const recorder = new MediaRecorder(acquired, { mimeType: mime });
      const run: Capture = { recorder, stream: acquired, chunks: [], canceled: false, released: false, token };
      capture.current = run;
      recorder.addEventListener('dataavailable', event => { if (!run.canceled && event.data.size) run.chunks.push(event.data); });
      recorder.addEventListener('error', () => { if (run === capture.current) cancel('Microphone recording failed. Check your input device and try again.'); });
      recorder.addEventListener('stop', () => {
        release(run);
        if (run.canceled || !mounted.current || token !== generation.current) return;
        clearTimers();
        capture.current = null;
        const type = recorder.mimeType || mime;
        const file = new Blob(run.chunks, { type });
        if (!file.size) { setPhase('idle'); setError('No audio was recorded. Check the microphone and try again.'); return; }
        const recorded: MediaAsset = { uri: URL.createObjectURL(file), file, type, name: `voice-${Date.now()}.${type.includes('mp4') ? 'm4a' : 'webm'}` };
        clip.current = recorded; setAsset(recorded); setPhase('preview');
      }, { once: true });
      recorder.start();
      const began = Date.now(); setElapsed(0); setPhase('recording');
      ticker.current = setInterval(() => { if (mounted.current && run === capture.current) setElapsed(Math.min(5000, Date.now() - began)); }, 100);
      limit.current = setTimeout(stop, 5000);
    } catch (failure) {
      if (!mounted.current || token !== generation.current) { acquired?.getTracks().forEach(track => track.stop()); return; }
      if (capture.current?.token === token) { capture.current.canceled = true; release(capture.current); capture.current = null; }
      else acquired?.getTracks().forEach(track => track.stop());
      clearTimers();
      pending.current = false; setPhase('idle');
      const name = failure && typeof failure === 'object' && 'name' in failure && typeof failure.name === 'string' ? failure.name : '';
      setError(name === 'NotAllowedError' ? 'Microphone permission denied. Allow microphone access in this browser and try again.' : name === 'NotFoundError' ? 'No microphone found. Connect a microphone and try again.' : 'Microphone could not start. Check browser permissions and your input device.');
    }
  }

  function discard() { if (sending.current) return; releaseClip(); setAsset(null); setError(null); setPhase('idle'); }
  async function send() {
    if (!clip.current || disabled || sending.current) return;
    const token = generation.current, recorded = clip.current;
    sending.current = true; setError(null); setPhase('sending');
    try {
      await onSend(recorded);
      if (mounted.current && token === generation.current && clip.current === recorded) { releaseClip(); setAsset(null); setPhase('idle'); }
    } catch (failure) {
      if (mounted.current && token === generation.current) { setPhase('preview'); setError(failure instanceof Error ? failure.message : 'Voice message could not be sent. Try again.'); }
    } finally { sending.current = false; }
  }

  return <section className={`voice-recorder voice-${phase}`} aria-label="Voice message recorder">
    {phase === 'idle' && <button className="record-voice-button" aria-label="Record voice" disabled={disabled} onClick={start}><Mic size={13}/>Record voice<span>up to 5s</span></button>}
    {phase === 'requesting' && <div className="voice-actions"><span role="status">Requesting microphone…</span><button onClick={() => cancel('Recording canceled.')} aria-label="Cancel recording">Cancel</button></div>}
    {phase === 'recording' && <div className="voice-actions"><span role="status"><i className="recording-light"/>Recording {(elapsed / 1000).toFixed(1)}s / 5s</span><button className="stop-voice-button" aria-label="Stop recording" onClick={stop}><Square size={10} fill="currentColor"/>Stop</button></div>}
    {phase === 'preparing' && <span role="status">Preparing voice preview…</span>}
    {asset && (phase === 'preview' || phase === 'sending') && <div className="voice-preview"><audio aria-label="Recorded voice preview" controls src={asset.uri}/><div className="voice-actions"><button aria-label="Discard recording" disabled={phase === 'sending'} onClick={discard}><Trash2 size={11}/>Discard</button><button className="send-voice-button" aria-label="Send voice" disabled={disabled || phase === 'sending'} onClick={send}><Send size={11}/>{phase === 'sending' ? 'Sending…' : 'Send voice'}</button></div></div>}
    {error && <p className="voice-error" role="alert">{error}</p>}
  </section>;
}
