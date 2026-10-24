import { uiStore } from '../../state/ui';

/*
 * The Recenter action (button / C key) without importing the 3D scene: CameraRig registers what "overview" means
 * while it is mounted.
 */

let overview: (() => Promise<void>) | null = null;

/** Back to the whole board, and automatic framing on again (also when the scene isn't mounted) */
export function recenter(): void {
  uiStore.update({ cameraManual: false });
  void overview?.();
}

/** CameraRig's hook; returns the unregister function */
export function setOverview(fn: () => Promise<void>): () => void {
  overview = fn;
  return () => {
    if (overview === fn) overview = null;
  };
}
