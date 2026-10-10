import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createMeshClient, useMesh } from './index';
import type { MeshClient } from './types';

afterEach(cleanup);
function View({ client }: { client: MeshClient }) {
  const state = useMesh(client);
  return <div>{Object.keys(state.messages).length} messages · {state.mode}</div>;
}
it('updates two subscriptions to one shared client and leaves disposal to its owner', async () => {
  const client = createMeshClient();
  const view = render(<><View client={client} /><View client={client} /></>);
  expect(screen.getAllByText('0 messages · replay')).toHaveLength(2);
  await act(async () => { await client.sendText('node0', 'node4', 'Together'); });
  expect(screen.getAllByText('1 messages · replay')).toHaveLength(2);
  view.rerender(<View client={client} />);
  await act(async () => { await client.sendText('node4', 'node0', 'Reply'); });
  expect(screen.getByText('2 messages · replay')).toBeTruthy();
  client.dispose();
});
