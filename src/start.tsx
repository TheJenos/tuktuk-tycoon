import { createRoot } from 'react-dom/client';
import { initAudio } from './audio';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { watchReducedMotion } from './ui/settings';
import '@fontsource-variable/league-spartan';
import './style.css';

watchReducedMotion();
initAudio();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root in index.html');

// The board, cards and dice draw their text onto canvases once, so the display font has to be
// ready first or the fallback gets baked in. Capped, so a font that fails to load can't block the game.
const fontReady = Promise.all([700, 800, 900].map((w) => document.fonts.load(`${w} 16px 'League Spartan Variable'`)));
const timeout = new Promise((resolve) => setTimeout(resolve, 3000));

void Promise.race([fontReady, timeout]).catch(() => {}).then(() => {
  // No <StrictMode>: its dev-only double mount would join, leave and rejoin the room,
  // and leaving as the last player deletes it.
  createRoot(root).render(<ErrorBoundary><App /></ErrorBoundary>);
});
