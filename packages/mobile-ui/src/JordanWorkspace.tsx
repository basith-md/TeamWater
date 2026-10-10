import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMesh } from '@teamwater/core';
import { PhoneChat } from './PhoneChat';
import type { PhoneChatProps } from './PhoneChat';
import { CodeWorkspace, WorkspaceNavigation, type CodeWorkspaceProps, type CodeWorkflowResult } from './CodeWorkspace';
export interface JordanWorkspaceProps extends Omit<PhoneChatProps, 'role'>, CodeWorkspaceProps {}
export function JordanWorkspace({ client, embedded, pickMedia, renderAudio, renderVoiceRecorder, onSendLink, ...codeProps }: JordanWorkspaceProps) {
  const [view, setView] = useState<'chat' | 'code'>('chat');
  const state = useMesh(client);

  async function sendLink(result: CodeWorkflowResult) {
    if (client.getSnapshot().mode !== 'live') throw new Error('Switch to Live simulation to send the link to Alex.');
    if (onSendLink) return onSendLink(result);
    const label = result.kind === 'prototype' ? 'Prototype draft' : 'Bug fix pull request';
    await client.sendText('node4', 'node0', `${label}${result.title ? `: ${result.title}` : ''}\n${result.url}`);
  }

  return <View style={styles.workspace}>
    <WorkspaceNavigation view={view} onNavigate={setView}/>
    <View style={[styles.page, view !== 'chat' && styles.hidden]} accessibilityElementsHidden={view !== 'chat'} importantForAccessibility={view !== 'chat' ? 'no-hide-descendants' : 'auto'}>
      <PhoneChat client={client} role="employee" embedded={embedded} pickMedia={pickMedia} renderAudio={view === 'chat' ? renderAudio : undefined} renderVoiceRecorder={renderVoiceRecorder ? props => view === 'chat' ? renderVoiceRecorder(props) : null : undefined}/>
    </View>
    <View style={[styles.page, view !== 'code' && styles.hidden]} accessibilityElementsHidden={view !== 'code'} importantForAccessibility={view !== 'code' ? 'no-hide-descendants' : 'auto'}>
      <CodeWorkspace key={`${state.mode}:${state.endpoint}`} {...codeProps} onSendLink={state.mode === 'live' ? sendLink : undefined}/>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, backgroundColor: '#faf8f3' },
  page: { flex: 1 },
  hidden: { display: 'none' }
});
