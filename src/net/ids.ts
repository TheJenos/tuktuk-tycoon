import type { PlayerId } from './types';

/*
 * Ids and codes. Everything random comes from crypto.getRandomValues (never Math.random), over an alphabet with no
 * 0/O/1/I so codes read aloud cleanly. It has exactly 32 characters, so `byte & 31` picks one without bias.
 */

export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Normal room codes are this long; Discord rooms are 'D' + 7 */
export const ROOM_CODE_LEN = 5;
/** Longest code an invite link may carry (inviteCode() cuts it here) */
export const ROOM_CODE_MAX = 10;

/** Ids the database rules accept: p_ (browser), d_ (Discord), b_ (reserved for bots) */
export const PLAYER_ID = /^[pdb]_[A-Za-z0-9_-]{6,40}$/;
export const ROOM_CODE = /^[A-Z0-9]{5,8}$/;

export function randomId(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += CODE_CHARS[b & 31];
  return s;
}

/** A browser player's id */
export const playerId = (): PlayerId => `p_${randomId(12)}`;

/** A Discord user's player id: the same on every device, so rejoining works across them */
export const discordPlayerId = (discordUserId: string): PlayerId => `d_${discordUserId}`;

export const isPlayerId = (v: unknown): v is PlayerId => typeof v === 'string' && PLAYER_ID.test(v);

/** An envelope id (dedupes a transaction the SDK re-runs after a lost ack) */
export const envelopeId = (): string => randomId(8);

/** A game id: a new one per start and rematch */
export const gameId = (): string => `g_${randomId(10)}`;

/** A uint32 seed for createGame */
export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 0;
}

/** A new room code */
export const roomCode = (): string => randomId(ROOM_CODE_LEN);

/** The fixed room code of a Discord Activity instance: 'D' + 7 characters of SHA-256(instanceId) */
export async function discordRoomCode(instanceId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(instanceId)));
  let s = 'D';
  for (let i = 0; i < 7; i++) s += CODE_CHARS[(digest[i] ?? 0) & 31];
  return s;
}

/** Room code from an invite: '#CODE' or '?room=CODE' (uppercased, junk stripped), or null */
export function inviteCode(loc: { hash: string; search: string } | null = typeof location === 'undefined' ? null : location): string | null {
  if (!loc) return null;
  const raw = new URLSearchParams(loc.search).get('room') ?? loc.hash.replace(/^#/, '');
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_MAX);
  return ROOM_CODE.test(code) ? code : null;
}

/** FNV-1a, 32 bits */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic [0, 1) stream (mulberry32), for bot decisions every driver would make the same way */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
