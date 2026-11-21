import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import { registerServiceWorker } from './lib/service-worker';
import './styles.css';
import { listenForAppLinks } from './lib/native';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
void listenForAppLinks().catch(() => { /* Only the phone app handles cookbook:// links. */ });
registerServiceWorker();
