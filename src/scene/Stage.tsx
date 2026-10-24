import { Canvas, type RootState } from '@react-three/fiber';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../state/session';
import { useSelector } from '../state/store';
import { uiStore } from '../state/ui';
import { settings } from '../ui/settings';
import { director } from '../view';
import { BackdropScene } from './BackdropScene';
import { FrameDriver } from './FrameDriver';
import { GameScene } from './GameScene';
import { Environment } from './Lights';
import { tierFor } from './quality';

/*
 * The one persistent canvas, fixed full-bleed behind all DOM and hidden from screen readers (everything it shows is
 * also in the DOM). It shows the game while a session runs and the lobby backdrop otherwise. Frames are drawn on
 * demand only. A lost WebGL context, or none at all, sets uiStore.gl so the HUD switches to its 2D board; the game
 * never needs the canvas to be playable.
 */

const hasWebGL = () => typeof window !== 'undefined' && 'WebGL2RenderingContext' in window;

/** A canvas that fails to start (no WebGL) takes only itself down */
class GlBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('3D view unavailable', err);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Context loss shows the 2D board. When the browser gives the context back the canvas is rebuilt from scratch: GPU
 * generated content (the environment map, shadow maps) does not survive a loss, and a fresh renderer is the one
 * state known to be whole.
 */
function watchContext(state: RootState, rebuild: () => void): void {
  const el = state.gl.domElement;
  el.addEventListener('webglcontextlost', (e) => {
    // Without preventDefault the browser never offers the context back
    e.preventDefault();
    uiStore.update({ gl: 'lost' });
    director.fastForward();
  });
  el.addEventListener('webglcontextrestored', rebuild);
  uiStore.update({ gl: 'ok' });
}

export function Stage() {
  const quality = useSelector(settings, (s) => s.quality);
  const session = useSession();
  const [broken, setBroken] = useState(() => !hasWebGL());
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (broken) uiStore.update({ gl: 'none' });
  }, [broken]);
  if (broken) return null;
  const tier = tierFor(quality);
  return (
    <GlBoundary onError={() => setBroken(true)}>
      <Canvas
        // A new tier needs a new context (antialias is fixed at creation), and so does a restored one
        key={`${quality}:${generation}`}
        frameloop="demand"
        dpr={tier.dpr}
        shadows={tier.shadowMap > 0 ? 'percentage' : false}
        gl={{ antialias: tier.antialias, alpha: false, powerPreference: 'high-performance' }}
        camera={{ fov: 40, position: [0, 16, 12], near: 0.1, far: 200 }}
        style={{ position: 'fixed', inset: 0 }}
        onCreated={(state) => watchContext(state, () => setGeneration((g) => g + 1))}
        aria-hidden
      >
        <color attach="background" args={['#0f1218']} />
        <Environment />
        <FrameDriver />
        {session ? <GameScene tier={tier} /> : <BackdropScene tier={tier} />}
      </Canvas>
    </GlBoundary>
  );
}
