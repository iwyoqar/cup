import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { start } from './store';

// Poster runs the bundle inside an iframe container that holds #app-container (the boilerplate renders into it); when it is missing (a simulator, a plain page) one is
// created. Nothing below can throw into Poster: every Poster call is wrapped, and a failing widget just shows a message.
const mount = document.getElementById('app-container') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'app-container' }));
createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
try {
  start();
} catch (err) {
  // never let the widget break the register — but never hide why it did not start either (TEMPORARY DIAGNOSTIC)
  console.error('[CUP widget] start() threw', err);
}
