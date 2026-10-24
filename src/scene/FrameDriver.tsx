import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { sessionStore } from '../state/session';
import { uiStore } from '../state/ui';
import { settings } from '../ui/settings';
import { director } from '../view';

/*
 * The canvas renders on demand: a frame is drawn only when something changed. This keeps frames coming while the
 * director plays (animations then invalidate themselves too) and kicks one whenever a store the scene draws from
 * changes, so an idle board costs nothing.
 */
export function FrameDriver() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const kick = () => invalidate();
    const offs = [director.idle.subscribe(kick), director.view.subscribe(kick), uiStore.subscribe(kick), settings.subscribe(kick), sessionStore.subscribe(kick)];
    return () => offs.forEach((off) => off());
  }, [invalidate]);
  useFrame(() => {
    if (!director.idle.get()) invalidate();
  });
  return null;
}
