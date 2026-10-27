import '@fontsource-variable/league-spartan';

/*
 * The display face, bundled. The board, cards and dice draw their text onto canvases once, so it has to be ready
 * before the first render or the fallback gets baked in. Capped, so a font that fails to load can't block the game.
 */
export function fontsReady(): Promise<void> {
  const loaded = Promise.all([700, 800, 900].map((w) => document.fonts.load(`${w} 16px 'League Spartan Variable'`)));
  const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
  return Promise.race([loaded, timeout]).then(() => undefined, () => undefined);
}
