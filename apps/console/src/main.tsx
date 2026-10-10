import { createRoot } from 'react-dom/client';
import { createMeshClient } from '@teamwater/core';
import { App } from './App';

const client = createMeshClient({ mode: 'live', endpoint: '/api' });
createRoot(document.getElementById('root')!).render(<App client={client}/>);
