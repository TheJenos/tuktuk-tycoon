import { IN_DISCORD } from './discord/patch';

/*
 * Installs the service worker (scripts/sw.js), which makes the game installable and lets it start offline.
 * Only in a production build: in dev it would serve stale modules. Not inside Discord, whose proxy serves
 * the Activity from its own origin.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || IN_DISCORD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => console.warn('Service worker not installed', e));
  };
  // After the page has loaded, so its precaching doesn't compete with the first visit's downloads.
  // This module arrives through main.tsx's dynamic import, often after the load event.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
