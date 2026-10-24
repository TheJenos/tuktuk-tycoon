import type { Quality } from '../ui/settings';

/** What each quality setting renders (see the design's performance table) */
export interface Tier {
  /** Device pixel ratio range for the canvas */
  dpr: [number, number];
  antialias: boolean;
  /** Directional shadow map size; 0 = no shadow map (blob shadows under tokens instead) */
  shadowMap: 0 | 1024 | 2048;
  /** Board texture edge in pixels */
  boardTex: 2048 | 4096;
  /** Rapier dice (when the setting allows) */
  physics: boolean;
}

export const TIERS: Record<Quality, Tier> = {
  low: { dpr: [1, 1], antialias: false, shadowMap: 0, boardTex: 2048, physics: false },
  medium: { dpr: [1, 1.5], antialias: true, shadowMap: 1024, boardTex: 4096, physics: true },
  high: { dpr: [1, 2], antialias: true, shadowMap: 2048, boardTex: 4096, physics: true },
};

export const tierFor = (q: Quality): Tier => TIERS[q] ?? TIERS.medium;
