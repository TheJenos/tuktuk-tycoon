import { PerformanceMonitor } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { getBoard } from '../rules';
import { useSelector } from '../state/store';
import { director, useView } from '../view';
import { Board } from './board/Board';
import { BoardPicker } from './board/BoardPicker';
import { JailBars } from './board/JailBars';
import { setBoardSize } from './board/layout';
import { Pieces } from './board/Pieces';
import { Spotlight } from './board/Spotlight';
import { TileHighlights } from './board/TileHighlights';
import { CameraRig } from './camera/CameraRig';
import { Cards } from './cards/Cards';
import { Dice } from './dice/Dice';
import { FloatingLabels } from './fx/FloatingLabels';
import { Lights, Table } from './Lights';
import type { Tier } from './quality';
import { Tokens } from './tokens/Tokens';

/** The game: everything the director animates, plus the camera rig and the tile picker */
export function GameScene({ tier }: { tier: Tier }) {
  // The geometry follows the board in play (a different size remounts everything laid out on it)
  const spaces = useView((v) => getBoard(v.game?.cfg.board ?? 'lanka').spaces.length);
  setBoardSize(spaces);
  return (
    <group key={spaces}>
      <Lights tier={tier} />
      <Table />
      <Board tier={tier} />
      <Pieces />
      <JailBars />
      <Spotlight />
      <TileHighlights />
      <BoardPicker />
      <Cards />
      <Tokens tier={tier} />
      <Dice tier={tier} />
      <FloatingLabels />
      <CameraRig />
      <AdaptiveResolution tier={tier} />
    </group>
  );
}

/**
 * Lowers the resolution (only that: shadows and textures change with the setting, never mid-game) when frames are
 * slow. Mounted only while the director plays, the one time frames come back to back, so idle gaps in the demand
 * frame loop don't read as a low frame rate.
 */
function AdaptiveResolution({ tier }: { tier: Tier }) {
  const playing = !useSelector(director.idle, (v) => v);
  const setDpr = useThree((s) => s.setDpr);
  // Never above the screen's own ratio
  const max = Math.max(tier.dpr[0], Math.min(tier.dpr[1], typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const dpr = useRef(max);
  if (!playing || max <= tier.dpr[0]) return null;
  const set = (v: number) => {
    dpr.current = Math.min(max, Math.max(tier.dpr[0], v));
    setDpr(dpr.current);
  };
  return (
    <PerformanceMonitor
      bounds={() => [38, 75]}
      flipflops={4}
      onDecline={() => set(dpr.current - 0.25)}
      onIncline={() => set(dpr.current + 0.25)}
      onFallback={() => set(tier.dpr[0])}
    />
  );
}
