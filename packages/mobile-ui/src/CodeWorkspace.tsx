import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
export interface CodeWorkflowState {
  kind: CodeWorkflowKind;
  phase: 'request' | 'agent_working' | 'tests' | 'publishing' | 'complete';
  connection: 'not_connected' | 'connected';
  runId?: string;
  agentName?: string;
  activity?: { id: string; text: string; time?: string }[];
  tests?: { label: string; status: 'passed' | 'failed' | 'running'; output?: string; url?: string }[];
  diff?: { text?: string; url?: string };
  result?: CodeWorkflowResult;
  projectUrl?: string;
  error?: string;
}
export interface CodeWorkspaceProps {
  workflow: CodeWorkflowState;
  initialSummary?: string;
  onSubmit: (request: CodeWorkflowRequest) => Promise<void>;
  onKindChange?: (kind: CodeWorkflowKind) => void;
  onSendLink?: (result: CodeWorkflowResult) => Promise<void>;
  disabled?: boolean;
  task?: CodeTask;
}
export type CodeWorkflowKind = 'prototype' | 'bugfix';
export interface CodeWorkflowRequest { kind: CodeWorkflowKind; summary: string }
export type CodeWorkflowResult = { kind: 'prototype'; url: string; title?: string } | { kind: 'bugfix'; url: string; title?: string };
export interface CodeTask {
  title: string;
  description: string;
  filename: string;
  source: string;
  expectations: string[];
}

export const DISCOUNTED_CART_EXERCISE: CodeTask = {
  title: 'Discounted cart total',
  description: 'Alex reports that a 10% discount on a $100 cart returns $99.90. The function subtracts the percentage as cents. Apply the discount to the subtotal instead.',
  filename: 'cart.ts · TypeScript exercise',
  source: 'function calculateTotal(\n  subtotalCents: number,\n  discountPercent: number\n): number {\n  return subtotalCents - discountPercent;\n}',
  expectations: ['10000 cents, 10% → $90.00', '10000 cents, 0% → $100.00', '10000 cents, 100% → $0.00']
};

const steps = [
  { phase: 'request', label: 'Request' },
  { phase: 'agent_working', label: 'Agent working' },
  { phase: 'tests', label: 'Tests' },
  { phase: 'publishing', label: 'Publishing' },
  { phase: 'complete', label: 'Deployed' }
] as const;

export function CodeWorkspace({ workflow, initialSummary = '', onSubmit, onKindChange, onSendLink, disabled = false, task = DISCOUNTED_CART_EXERCISE }: CodeWorkspaceProps) {
  const [kind, setKind] = useState<CodeWorkflowKind>(workflow.kind);
  const [summaries, setSummaries] = useState<Record<CodeWorkflowKind, string>>({ prototype: workflow.kind === 'prototype' ? initialSummary : '', bugfix: workflow.kind === 'bugfix' ? initialSummary : '' });
  const summary = summaries[kind];
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const linkInFlight = useRef(false);
  const submitGeneration = useRef(0);
  const linkGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setKind(workflow.kind); }, [workflow.kind]);
  useEffect(() => {
    submitGeneration.current++;
    inFlight.current = false;
    setPending(false); setSubmitted(false); setError(null);
  }, [workflow.connection, workflow.kind, workflow.runId]);
  const canSubmit = !disabled && workflow.connection === 'connected' && workflow.phase === 'request' && !pending && Boolean(summary.trim());
  const visibleSteps = kind === 'prototype' ? steps : steps.filter(step => step.phase !== 'publishing').map(step => step.phase === 'complete' ? { ...step, label: 'PR ready' } : step);
  const phaseLabel = workflow.phase === 'complete' ? (kind === 'prototype' ? 'Deployed' : 'PR ready') : workflow.phase === 'publishing' && kind === 'bugfix' ? 'Preparing PR' : steps.find(step => step.phase === workflow.phase)?.label || 'Request';
  const result = workflow.phase === 'complete' && workflow.result?.kind === kind ? workflow.result : undefined;
  useEffect(() => {
    linkGeneration.current++;
    linkInFlight.current = false;
    setSendingLink(false); setLinkSent(false);
  }, [result?.url, result?.kind, workflow.runId]);

  function chooseKind(next: CodeWorkflowKind) {
    if (pending || workflow.phase !== 'request') return;
    setKind(next); setError(null); setSubmitted(false); onKindChange?.(next);
  }

  async function submit() {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    const generation = submitGeneration.current;
    setPending(true); setError(null); setSubmitted(false);
    try {
      await onSubmit({ kind, summary: summary.trim() });
      if (mounted.current && generation === submitGeneration.current) setSubmitted(true);
    } catch (cause) {
      if (mounted.current && generation === submitGeneration.current) setError(cause instanceof Error ? cause.message : 'The summary could not be submitted. Try again.');
    } finally {
      if (generation === submitGeneration.current) {
        inFlight.current = false;
        if (mounted.current) setPending(false);
      }
    }
  }

  async function sendLink() {
    if (!result || !onSendLink || disabled || linkInFlight.current) return;
    linkInFlight.current = true; setSendingLink(true); setError(null); setLinkSent(false);
    const generation = linkGeneration.current;
    try {
      await onSendLink(result);
      if (mounted.current && generation === linkGeneration.current) setLinkSent(true);
    } catch (cause) {
      if (mounted.current && generation === linkGeneration.current) setError(cause instanceof Error ? cause.message : 'The link could not be sent. Try again.');
    } finally {
      if (generation === linkGeneration.current) {
        linkInFlight.current = false;
        if (mounted.current) setSendingLink(false);
      }
    }
  }

  function openLink(url: string) {
    void Linking.openURL(url).catch(() => { if (mounted.current) setError('This link could not be opened. Try again.'); });
  }

  return <View style={styles.workspace}>
    <View style={styles.heading}>
      <Text style={styles.eyebrow}>JORDAN’S WORKSPACE</Text>
      <Text style={styles.title}>Code</Text>
      <Text style={styles.subtitle}>{kind === 'prototype' ? 'Build an early draft. Send Alex the app.' : 'Fix the problem. Send Alex a reviewable change.'}</Text>
    </View>
    <View style={styles.kindChoices}>{(['prototype', 'bugfix'] as const).map(choice => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={choice === 'prototype' ? 'Build a prototype' : 'Fix a bug'} accessibilityState={{ selected: kind === choice }} disabled={pending || workflow.phase !== 'request'} onPress={() => chooseKind(choice)} style={[styles.kindChoice, kind === choice && styles.kindChoiceActive]}><Text style={[styles.kindLabel, kind === choice && styles.kindLabelActive]}>{choice === 'prototype' ? 'Build a prototype' : 'Fix a bug'}</Text></Pressable>)}</View>
    <View style={styles.steps}>
      {visibleSteps.map((step, index) => <React.Fragment key={step.phase}>
        {index > 0 && <Text style={styles.stepArrow}>›</Text>}
        <View style={styles.step}>
          <View style={[styles.stepDot, workflow.phase === step.phase && styles.stepDotActive]}><Text style={[styles.stepNumber, workflow.phase === step.phase && styles.stepNumberActive]}>{index + 1}</Text></View>
          <Text style={[styles.stepLabel, workflow.phase === step.phase && styles.stepLabelActive]}>{step.label}</Text>
        </View>
      </React.Fragment>)}
    </View>
    <View style={styles.statusLine}>
      <Text accessibilityLabel="Workflow status" accessibilityLiveRegion="polite" style={styles.status}>{phaseLabel}</Text>
      <Text style={styles.connection}>{workflow.connection === 'connected' ? (workflow.agentName || 'Agent connected') : 'Awaiting connection'}</Text>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {kind === 'prototype' ? <View style={styles.task}>
        <Text style={styles.eyebrow}>ALEX’S REQUEST</Text>
        <Text style={styles.quote}>Can I see a draft of the prototype a week early?</Text>
        <Text style={styles.sectionTitle}>Camp task &amp; supply tracker</Text>
        <Text style={styles.body}>Build a small app for a camp team to track tasks, owners, and shared supplies. Keep the first draft simple: no accounts or payments.</Text>
        <Text style={styles.caption}>Example prototype brief</Text>
      </View> : <View style={styles.task}>
        <Text style={styles.eyebrow}>TASK CONTEXT</Text>
        <Text style={styles.sectionTitle}>{task.title}</Text>
        <Text style={styles.body}>{task.description}</Text>
        <View style={styles.codePanel}>
          <Text style={styles.filename}>{task.filename}</Text>
          <Text selectable style={styles.code}>{task.source}</Text>
        </View>
        <Text style={styles.caption}>Expected behavior · reference cases</Text>
        {task.expectations.map(expectation => <Text key={expectation} style={styles.expectation}>{expectation}</Text>)}
      </View>}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{kind === 'prototype' ? 'Describe the prototype' : 'Describe the problem'}</Text>
        <Text style={styles.body}>{kind === 'prototype' ? 'Write your own brief: who it helps, what it should do, and what Alex needs to review.' : 'Summarize Alex’s message in your own words. Include what fails and what should happen.'}</Text>
        <TextInput accessibilityLabel="Problem summary" multiline value={summary} onChangeText={value => { setSummaries(current => ({ ...current, [kind]: value })); setSubmitted(false); }} editable={!pending && !disabled && workflow.phase === 'request'} placeholder={kind === 'prototype' ? 'Build a camp tracker with tasks, owners, and a shared supply list…' : 'The discount is subtracted as cents instead of a percentage…'} placeholderTextColor="#8b877c" style={styles.input}/>
        {workflow.connection !== 'connected' && <Text style={styles.notice}>Agent execution is not connected yet.</Text>}
        {(error || workflow.error) && <Text accessibilityRole="alert" style={styles.error}>{error || workflow.error}</Text>}
        {submitted && workflow.phase === 'request' && <Text accessibilityLiveRegion="polite" style={styles.notice}>Summary submitted. Waiting for agent activity.</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Submit problem summary" disabled={!canSubmit} onPress={() => { void submit(); }} style={[styles.submit, !canSubmit && styles.submitDisabled]}><Text style={styles.submitText}>{pending ? 'Submitting…' : 'Send to agent'} <Text>↗</Text></Text></Pressable>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Agent activity</Text>
        {workflow.projectUrl && <Pressable accessibilityRole="link" accessibilityLabel="Open agent project" onPress={() => openLink(workflow.projectUrl!)} style={styles.link}><Text style={styles.linkText}>Open agent project ↗</Text></Pressable>}
        {workflow.activity?.length ? workflow.activity.map(item => <View key={item.id} style={styles.activity}><View style={styles.activityDot}/><View style={styles.activityCopy}><Text style={styles.body}>{item.text}</Text>{item.time && <Text style={styles.caption}>{item.time}</Text>}</View></View>) : <Text style={styles.muted}>No agent activity reported yet.</Text>}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tests</Text>
        {workflow.tests?.length ? workflow.tests.map((test, index) => <View key={`${test.label}-${index}`} style={styles.result}>
          <View style={styles.resultHeading}><Text style={styles.resultLabel}>{test.label}</Text><Text style={[styles.testStatus, test.status === 'passed' ? styles.passed : test.status === 'failed' ? styles.failed : styles.running]}>{test.status}</Text></View>
          {test.output && <Text selectable style={styles.output}>{test.output}</Text>}
          {test.url && <Pressable accessibilityRole="link" accessibilityLabel="Open test run" onPress={() => openLink(test.url!)} style={styles.link}><Text style={styles.linkText}>View test run ↗</Text></Pressable>}
        </View>) : <Text style={styles.muted}>No test results reported yet.</Text>}
      </View>
      {workflow.diff && <View style={styles.section}>
        <Text style={styles.sectionTitle}>Changes</Text>
        {workflow.diff.text && <Text selectable style={styles.output}>{workflow.diff.text}</Text>}
        {workflow.diff.url && <Pressable accessibilityRole="link" accessibilityLabel="Open diff" onPress={() => openLink(workflow.diff!.url!)} style={styles.link}><Text style={styles.linkText}>Review diff ↗</Text></Pressable>}
      </View>}
      {result && <View style={styles.pr}>
        <Text style={styles.eyebrow}>{result.kind === 'prototype' ? 'DEPLOYED PROTOTYPE' : 'PULL REQUEST'}</Text>
        <Text style={styles.sectionTitle}>{result.title || (result.kind === 'prototype' ? 'Draft ready to review' : 'Change ready to review')}</Text>
        <Pressable accessibilityRole="link" accessibilityLabel={result.kind === 'prototype' ? 'Open deployed prototype' : 'Open pull request'} onPress={() => openLink(result.url)} style={styles.link}><Text style={styles.linkText}>{result.kind === 'prototype' ? 'Open deployed prototype' : 'Open pull request'} ↗</Text></Pressable>
        {onSendLink && <Pressable accessibilityRole="button" accessibilityLabel="Send link to Alex" disabled={disabled || sendingLink} onPress={() => { void sendLink(); }} style={[styles.submit, (disabled || sendingLink) && styles.submitDisabled]}><Text style={styles.submitText}>{sendingLink ? 'Sending link…' : 'Send link to Alex'}</Text></Pressable>}
        {linkSent && <Text accessibilityLiveRegion="polite" style={styles.notice}>Link queued for Alex through the mesh.</Text>}
      </View>}
    </ScrollView>
  </View>;
}

export interface WorkspaceNavigationProps { view: 'chat' | 'code'; onNavigate: (view: 'chat' | 'code') => void }
export function WorkspaceNavigation({ view, onNavigate }: WorkspaceNavigationProps) {
  const [open, setOpen] = useState(false);
  return <View style={styles.navigation}>
    <View style={styles.navBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Close Jordan menu' : 'Open Jordan menu'} accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={styles.menuButton}>
        <View style={styles.menuLine}/><View style={styles.menuLine}/><View style={styles.menuLine}/>
      </Pressable>
      <Text accessibilityLabel="Current workspace" style={styles.navTitle}>{view === 'chat' ? 'Chat' : 'Code'}</Text>
      <Text style={styles.navIdentity}>Jordan</Text>
    </View>
    {open && <View style={styles.menu}>
      <Text style={styles.menuEyebrow}>WORKSPACE</Text>
      {(['chat', 'code'] as const).map(destination => <Pressable key={destination} accessibilityRole="button" accessibilityLabel={destination === 'chat' ? 'Chat' : 'Code'} accessibilityState={{ selected: view === destination }} onPress={() => { setOpen(false); onNavigate(destination); }} style={[styles.menuItem, view === destination && styles.menuItemSelected]}>
        <Text style={styles.menuIcon}>{destination === 'chat' ? '○' : '</>'}</Text><Text style={styles.menuText}>{destination === 'chat' ? 'Chat' : 'Code'}</Text>
      </Pressable>)}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, backgroundColor: '#faf8f3', minHeight: 560 },
  heading: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  eyebrow: { color: '#8b6d55', fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginBottom: 7 },
  title: { color: '#232825', fontSize: 27, fontWeight: '700', letterSpacing: -0.6 },
  subtitle: { color: '#77766c', fontSize: 12, lineHeight: 18, marginTop: 5 },
  kindChoices: { flexDirection: 'row', gap: 6, marginHorizontal: 16, marginBottom: 17, padding: 4, borderRadius: 10, backgroundColor: '#eee9df' },
  kindChoice: { flex: 1, minHeight: 44, paddingHorizontal: 7, borderRadius: 7, justifyContent: 'center', alignItems: 'center' },
  kindChoiceActive: { backgroundColor: '#fffdf8' },
  kindLabel: { fontSize: 11, color: '#827c6e', fontWeight: '600' },
  kindLabelActive: { color: '#c65d2d' },
  quote: { color: '#354030', fontSize: 17, lineHeight: 25, fontWeight: '600', marginBottom: 5 },
  steps: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 14, paddingBottom: 15 },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  stepDot: { borderRadius: 13, width: 25, height: 25, backgroundColor: '#eee9df', alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: '#e96f34' },
  stepNumber: { color: '#878275', fontSize: 10, fontWeight: '700' },
  stepNumberActive: { color: '#fff' },
  stepLabel: { color: '#878275', fontSize: 11, textAlign: 'center', lineHeight: 14 },
  stepLabelActive: { color: '#232825', fontWeight: '700' },
  stepArrow: { color: '#bbb4a6', fontSize: 19, marginTop: 1 },
  statusLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingHorizontal: 20, paddingVertical: 11, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#e7e1d7', backgroundColor: '#f3f0e7' },
  status: { color: '#383d37', fontSize: 11, fontWeight: '700' },
  connection: { color: '#8b8374', fontSize: 10, flexShrink: 1, textAlign: 'right' },
  scroll: { flex: 1 },
  content: { padding: 20, gap: 23, paddingBottom: 32 },
  task: { gap: 8 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#232825', letterSpacing: -0.2 },
  body: { color: '#5d625a', fontSize: 12, lineHeight: 19 },
  muted: { color: '#888477', fontSize: 12, lineHeight: 19 },
  codePanel: { backgroundColor: '#252b27', borderRadius: 10, padding: 12, gap: 10, marginVertical: 3 },
  filename: { color: '#bcae94', fontSize: 9, letterSpacing: 0.3 },
  code: { color: '#e9e9d7', fontFamily: 'monospace', fontSize: 10, lineHeight: 17 },
  caption: { color: '#8b877a', fontSize: 10, lineHeight: 15 },
  expectation: { color: '#62685c', fontFamily: 'monospace', fontSize: 10, lineHeight: 16 },
  input: { backgroundColor: '#fffdfa', borderColor: '#dcd5c8', borderWidth: 1, borderRadius: 10, minHeight: 104, maxHeight: 180, padding: 12, color: '#232825', fontSize: 13, lineHeight: 20, textAlignVertical: 'top' },
  notice: { color: '#817253', fontSize: 11, lineHeight: 17 },
  error: { color: '#a23e2d', fontSize: 12, lineHeight: 18 },
  submit: { backgroundColor: '#e96f34', borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 12 },
  submitDisabled: { backgroundColor: '#e4ddcf' },
  submitText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  activity: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  activityDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#e96f34', marginTop: 7 },
  activityCopy: { flex: 1, gap: 2 },
  result: { borderLeftWidth: 2, borderLeftColor: '#c7cdbb', paddingLeft: 10, gap: 7 },
  resultHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'space-between' },
  resultLabel: { color: '#40483d', fontSize: 11, fontWeight: '600', flex: 1 },
  testStatus: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  passed: { color: '#537244' }, failed: { color: '#a23e2d' }, running: { color: '#926721' },
  output: { backgroundColor: '#eeebe2', borderRadius: 7, padding: 10, fontFamily: 'monospace', fontSize: 10, lineHeight: 17, color: '#46503e' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#c75826', fontSize: 12, fontWeight: '700' },
  pr: { backgroundColor: '#edeedf', borderRadius: 10, padding: 14, gap: 5 },
  navigation: { zIndex: 20, backgroundColor: '#faf8f3' },
  navBar: { height: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 7, borderBottomWidth: 1, borderColor: '#e7e1d7' },
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', gap: 4 },
  menuLine: { width: 17, height: 1.5, backgroundColor: '#353d34', borderRadius: 1 },
  navTitle: { color: '#232825', fontSize: 14, fontWeight: '700', flex: 1 },
  navIdentity: { color: '#8b877a', fontSize: 11, paddingRight: 10 },
  menu: { position: 'absolute', top: 50, left: 9, width: 185, borderRadius: 12, padding: 8, borderColor: '#ded7ca', borderWidth: 1, backgroundColor: '#fffdf7', boxShadow: '0 12px 30px rgba(38, 40, 33, .14)' },
  menuEyebrow: { fontSize: 9, letterSpacing: 1.1, color: '#918773', padding: 10 },
  menuItem: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 7 },
  menuItemSelected: { backgroundColor: '#f5e6d9' },
  menuIcon: { color: '#c86333', width: 24, fontSize: 15, textAlign: 'center' },
  menuText: { color: '#30382e', fontSize: 14, fontWeight: '600' }
});
