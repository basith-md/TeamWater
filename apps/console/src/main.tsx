import { createRoot } from 'react-dom/client';
import { createMeshClient } from '@teamwater/core';
import { App } from './App';

// Hosted builds point at the deployed simulator; local dev uses the Vite proxy.
const endpoint = import.meta.env.VITE_BACKEND_URL || '/api';
const client = createMeshClient({ mode: 'live', endpoint });
createRoot(document.getElementById('root')!).render(<App client={client}/>);
