import { createRoot } from 'react-dom/client';
import { initAudio } from './audio';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { watchReducedMotion } from './ui/settings';
import { fontsReady } from './ui/fonts';
import { registerServiceWorker } from './pwa';
import './style.css';

watchReducedMotion();
initAudio();
registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root in index.html');

void fontsReady().then(() => {
  // No <StrictMode>: its dev-only double mount would join, leave and rejoin the room,
  // and leaving as the last player deletes it.
  createRoot(root).render(<ErrorBoundary><App /></ErrorBoundary>);
});
