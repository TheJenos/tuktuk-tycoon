import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { pwa } from './scripts/pwa';

export default defineConfig({
  // wasm(): Rapier's browser build imports its .wasm as an ES module (the dice simulation)
  // pwa(): the service worker, so the game installs as an app and starts offline
  plugins: [react(), wasm(), pwa()],
  // Pre-bundling would inline that .wasm as base64; served as a file, dev loads it like production
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  build: {
    target: 'es2022',
    // three.js is ~740 kB minified and can't be split further: R3F's element catalogue references
    // every export, so none of it tree-shakes away.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Libraries in their own files: they change far less often than the game, so returning
        // players keep them cached across deploys.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            {
              name: 'r3f',
              test: /node_modules[\\/](@react-three[\\/]|camera-controls[\\/]|three-stdlib[\\/]|zustand[\\/])/,
            },
            { name: 'firebase', test: /node_modules[\\/](@?firebase)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
});
