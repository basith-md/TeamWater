import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AiModel, AiRequest, AiStage, MeshClient, MeshState } from '@teamwater/core';

export interface ModelPickerProps { models: AiModel[]; value: number; onChange: (index: number) => void; disabled: boolean }
export interface AiChatProps {
  client: MeshClient;
  /** This phone's node. */
  src: string;
  nodeName?: (id: string) => string;
  renderModelPicker?: (props: ModelPickerProps) => React.ReactNode;
  disabled?: boolean;
}

const STEPS: { stage: AiStage; label: string }[] = [
  { stage: 'to_gateway', label: 'Sealed question crossing the mesh' },
  { stage: 'ai_working', label: 'Gateway relayed it · AI answering' },
  { stage: 'answer_arriving', label: 'Sealed answer crossing back' },
  { stage: 'answered', label: 'Opened on this phone' },
];
const utf8Bytes = (text: string) => { let n = 0; for (const ch of text) { const c = ch.codePointAt(0)!; n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
const ORDER: AiStage[] = ['waiting_for_gateway', 'to_gateway', 'ai_working', 'answer_arriving', 'answered'];
const MAX_QUESTION_BYTES = 400;

export function AiChat({ client, src, nodeName = id => id, renderModelPicker, disabled = false }: AiChatProps) {
  const state = useSyncExternalStore(client.subscribe.bind(client), client.getSnapshot.bind(client), client.getSnapshot.bind(client));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const list = useRef<ScrollView>(null);
  const session = useMemo(() => ({}), [client, src, state.mode, state.endpoint]);
  const sessionRef = useRef(session); sessionRef.current = session;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setBusy(false); setError(null); setModels([]); setModelIndex(0); }, [session]);
  useEffect(() => {
    if (state.mode !== 'live' || !client.listModels) return;
    let active = true;
    client.listModels().then(models => {
      if (!active || !mounted.current || sessionRef.current !== session) return;
      setModels(models);
      setModelIndex(index => models.some(model => model.index === index) ? index : models[0]?.index ?? 0);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [client, session, state.mode, state.connection]);

  const ai = state.ai;
  const requests = (ai?.requests ?? []).filter(r => r.asker === src).sort((a, b) => a.createdAt - b.createdAt);
  const gateway = ai?.internetNode ?? null;
  const unavailable = state.mode !== 'live' ? 'Water AI runs on the live mesh simulation. Switch the console to Live.'
    : !client.askAi || ai === null || ai === undefined ? 'This mesh service does not support Water AI.'
    : !ai.connectedNodes.includes(src) ? 'This phone is not connected to Water AI. Connect it in Water Connect.' : null;
  const question = draft.trim().replace(/\s+/g, ' ');
  const questionBytes = utf8Bytes(question);
  const overLimit = questionBytes > MAX_QUESTION_BYTES;
  const sendDisabled = disabled || busy || !question || !!unavailable || overLimit;

  async function ask() {
    const sentDraft = draft;
    if (sendDisabled || !client.askAi) return;
    setBusy(true); setError(null);
    const active = () => mounted.current && sessionRef.current === session;
    try { await client.askAi(src, question, modelIndex); if (active()) setDraft(current => current === sentDraft ? '' : current); }
    catch (failure) { if (active()) setError(failure instanceof Error ? failure.message : 'Could not ask. Try again.'); }
    finally { if (active()) setBusy(false); }
  }

  const current = models.find(m => m.index === modelIndex);
  return <View style={styles.wrap}>
    <View style={styles.gatewayBar} accessibilityLabel="Internet gateway status">
      <View style={[styles.gwDot, !gateway && styles.gwDotOff]}/>
      <Text style={styles.gatewayText}>{gateway ? gateway === src ? 'This phone has internet: it is its own gateway' : `Gateway: ${nodeName(gateway)} has internet` : 'No phone has internet: questions will wait'}</Text>
    </View>
    <ScrollView ref={list} style={styles.list} contentContainerStyle={styles.listContent} onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
      {requests.length === 0 && <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Ask the field guide.</Text>
        <Text style={styles.emptyText}>In this simulation, your question crosses the mesh as a sealed transfer to an internet gateway. Answers use field-guide context when available; answers from general AI knowledge are labelled.</Text>
        {!unavailable && <Pressable accessibilityRole="button" disabled={disabled || busy} style={[styles.starter, (disabled || busy) && styles.disabled]} onPress={() => setDraft('How long does a packet take per hop at Long Fast?')}><Text style={styles.starterText}>Try an example question ↗</Text></Pressable>}
      </View>}
      {requests.map(r => <AiExchange key={r.id} request={r} state={state} nodeName={nodeName}/>)}
    </ScrollView>
    {(error || unavailable || overLimit) && <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error || unavailable || `Keep your question within ${MAX_QUESTION_BYTES} UTF-8 bytes.`}</Text></View>}
    <View style={styles.composeArea}>
      <View style={styles.compose}>
        <TextInput accessibilityLabel="Ask Water AI" placeholder="Ask Water AI…" placeholderTextColor="#8d8982" value={draft} onChangeText={text => { if (!disabled) setDraft(text); }} editable={!disabled && !unavailable} multiline maxLength={MAX_QUESTION_BYTES} style={styles.input}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Send question" disabled={sendDisabled} onPress={ask} style={[styles.send, sendDisabled && styles.disabled]}>
          {busy ? <ActivityIndicator color="#fff" size="small"/> : <Text style={styles.sendArrow}>↑</Text>}
        </Pressable>
      </View>
      <View style={styles.footer}>
        {renderModelPicker && models.length > 0
          ? renderModelPicker({ models, value: modelIndex, onChange: setModelIndex, disabled: disabled || busy || !!unavailable })
          : <Text style={styles.modelText}>Model: {current?.label ?? 'service default'}</Text>}
        <Text style={styles.footerHint}>{`${questionBytes}/${MAX_QUESTION_BYTES} B`}</Text>
      </View>
      {current && current.privacyLevel !== 'ok' && <Text style={styles.privacyWarn}>{current.privacy}</Text>}
    </View>
  </View>;
}

function AiExchange({ request: r, state, nodeName }: { request: AiRequest; state: MeshState; nodeName: (id: string) => string }) {
  const reached = ORDER.indexOf(r.stage);
  const transfer = (ids: string[]) => { const m = ids.length ? state.messages[ids[ids.length - 1]] : undefined; return m ? `${m.received}/${m.totalChunks} chunks` : ''; };
  const done = r.stage === 'answered';
  const tone = r.stage === 'failed' || r.outcome === 'blocked' || r.outcome === 'error' ? 'bad' : r.outcome === 'no_grounding' || r.outcome === 'over_budget' || r.outcome === 'general' ? 'warn' : 'ok';
  return <View style={styles.exchange}>
    <View style={styles.questionRow}>
      <Text style={styles.sender}>YOU → WATER AI · {r.model.split('/')[1] ?? r.model}</Text>
      <View style={styles.question}><Text style={styles.questionText}>{r.question}</Text></View>
    </View>

    {!done && r.stage !== 'failed' && <View style={styles.timeline} accessibilityLabel="AI request progress">
      {r.stage === 'waiting_for_gateway' && <Step state="active" label={r.note || 'Waiting for a phone with internet'} detail={r.stages.some(stage => stage.stage === 'ai_working') ? 'The AI may already have processed this request' : 'Nothing has been sent to the AI yet'}/>}
      {STEPS.map(step => {
        const index = ORDER.indexOf(step.stage);
        const status = reached > index ? 'done' : reached === index ? 'active' : 'todo';
        const detail = step.stage === 'to_gateway' && r.gateway ? `${nodeName(r.asker)} → ${nodeName(r.gateway)} · ${transfer(r.requestMessageIds)}`
          : step.stage === 'answer_arriving' && r.gateway ? `${nodeName(r.gateway)} → ${nodeName(r.asker)} · ${transfer(r.answerMessageIds)}` : '';
        return <Step key={step.stage} state={status} label={step.label} detail={status === 'todo' ? '' : detail}/>;
      })}
      {r.attempts > 1 && <Text style={styles.retry}>Attempt {r.attempts} · reusing the same request ID</Text>}
    </View>}

    {done && <View style={styles.answerRow}>
      <Text style={styles.sender}>WATER AI · VIA {r.gateway ? nodeName(r.gateway).toUpperCase() : 'GATEWAY'}</Text>
      <View style={[styles.answer, tone === 'warn' && styles.answerWarn, tone === 'bad' && styles.answerBad]}>
        <Text style={styles.answerText}>{r.answer}</Text>
        {r.sources.length > 0 && <View style={styles.sources}>{r.sources.map(s => <Text key={s} style={styles.source}>↳ Source: {s}</Text>)}</View>}
        <Text style={styles.disclosure}>{r.outcome === 'ok' ? 'AI answer with field-guide context · not checked by a person' : r.outcome === 'general' ? 'Not in the field guide · general AI knowledge · may be wrong' : r.outcome === 'no_grounding' ? 'Not in the field guide, so no model was asked' : r.outcome === 'blocked' ? 'Blocked before reaching any model' : 'No AI answer'}</Text>
      </View>
      <Text style={styles.delivery}>{r.receipt ? 'Answered · receipt sent to gateway' : 'Answered'}</Text>
    </View>}

    {r.stage === 'failed' && <View style={[styles.answer, styles.answerBad]}>
      <Text style={styles.answerText}>Not answered</Text>
      <Text style={styles.disclosure}>{r.error || 'The request failed.'}</Text>
    </View>}
  </View>;
}

function Step({ state, label, detail }: { state: 'done' | 'active' | 'todo'; label: string; detail?: string }) {
  return <View style={styles.step}>
    <View style={[styles.stepDot, state === 'done' && styles.stepDone, state === 'active' && styles.stepActive]}>{state === 'done' && <Text style={styles.check}>✓</Text>}</View>
    <View style={styles.stepCopy}>
      <Text style={[styles.stepLabel, state === 'todo' && styles.stepTodo]}>{label}</Text>
      {!!detail && <Text style={styles.stepDetail}>{detail}</Text>}
    </View>
    {state === 'active' && <ActivityIndicator size="small" color="#d8824e"/>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, backgroundColor: '#faf8f3' },
  gatewayBar: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, paddingVertical: 9, backgroundColor: '#eeede5', borderBottomWidth: 1, borderColor: '#e2dfd5' },
  gwDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#659371' }, gwDotOff: { backgroundColor: '#be7853' },
  gatewayText: { fontSize: 10, color: '#5c6658', flex: 1 },
  list: { flex: 1, minHeight: 0 }, listContent: { padding: 16, gap: 18, flexGrow: 1 },
  empty: { paddingVertical: 24 }, emptyTitle: { color: '#494c42', fontSize: 20, fontWeight: '600' },
  emptyText: { fontSize: 12, lineHeight: 19, color: '#888477', marginTop: 8 },
  starter: { marginTop: 16, borderWidth: 1, borderColor: '#e4c7b6', borderRadius: 8, padding: 11 }, starterText: { color: '#ae5f38', fontSize: 11, fontWeight: '600' },
  exchange: { gap: 10 },
  questionRow: { alignSelf: 'flex-end', alignItems: 'flex-end', width: '90%', gap: 5 },
  sender: { fontSize: 8, color: '#969184', letterSpacing: .8 },
  question: { backgroundColor: '#303831', borderRadius: 13, borderTopRightRadius: 3, padding: 12, width: '100%' },
  questionText: { color: '#f8f6ef', fontSize: 13, lineHeight: 19 },
  timeline: { backgroundColor: '#f3f0e7', borderRadius: 10, padding: 11, gap: 8, borderWidth: 1, borderColor: '#e8e3d8' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  stepDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: '#cbc6b8', alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: '#6f8f5d', borderColor: '#6f8f5d' }, stepActive: { borderColor: '#d8824e', borderWidth: 2 },
  check: { color: '#fff', fontSize: 8, lineHeight: 10 },
  stepCopy: { flex: 1 }, stepLabel: { fontSize: 11, color: '#3f463d' }, stepTodo: { color: '#aaa597' },
  stepDetail: { fontSize: 9, color: '#8d8878', marginTop: 2 },
  retry: { fontSize: 9, color: '#a36440' },
  answerRow: { alignSelf: 'flex-start', width: '92%', gap: 5 },
  answer: { backgroundColor: '#eaf0e3', borderRadius: 13, borderTopLeftRadius: 3, padding: 12, borderWidth: 1, borderColor: '#d6e2cb' },
  answerWarn: { backgroundColor: '#f8efd9', borderColor: '#ecdcb3' }, answerBad: { backgroundColor: '#fbe7df', borderColor: '#f0c9ba' },
  answerText: { color: '#2f3a2c', fontSize: 13, lineHeight: 19 },
  sources: { marginTop: 8, gap: 2 }, source: { fontSize: 10, color: '#5c7a4b' },
  disclosure: { fontSize: 9, lineHeight: 13, color: '#7f7a6b', marginTop: 8 },
  delivery: { fontSize: 8, color: '#8a836f' },
  error: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fceae0' }, errorText: { color: '#a74c30', fontSize: 11, lineHeight: 16 },
  composeArea: { backgroundColor: '#f5f2ea', padding: 14, borderTopWidth: 1, borderColor: '#e7e1d7' },
  compose: { borderWidth: 1, borderColor: '#ded8cc', backgroundColor: '#fffcf7', borderRadius: 12, padding: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 90, fontSize: 13, lineHeight: 19, padding: 8, color: '#30372e', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : {}) },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e3773e', alignItems: 'center', justifyContent: 'center' },
  sendArrow: { color: '#fff', fontSize: 20, lineHeight: 24 }, disabled: { opacity: .45 },
  footer: { marginTop: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  modelText: { fontSize: 10, color: '#888371' }, footerHint: { fontSize: 8, color: '#a89d89', letterSpacing: .6 },
  privacyWarn: { fontSize: 9, color: '#a8771f', marginTop: 6 },
});
