import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import { registerServiceWorker } from './lib/service-worker';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
registerServiceWorker();
