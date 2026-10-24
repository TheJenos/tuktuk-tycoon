import { describe, expect, it } from 'vitest';
import {
  CODE_CHARS,
  discordPlayerId,
  discordRoomCode,
  envelopeId,
  gameId,
  inviteCode,
  isPlayerId,
  playerId,
  randomId,
  ROOM_CODE,
  roomCode,
  seededRandom,
} from '../ids';

describe('ids', () => {
  it('uses the 32-character code alphabet', () => {
    expect(CODE_CHARS).toHaveLength(32);
    expect(new Set(CODE_CHARS).size).toBe(32);
    const id = randomId(400);
    expect([...id].every((c) => CODE_CHARS.includes(c))).toBe(true);
    expect(new Set(id).size).toBeGreaterThan(24);
    expect(envelopeId()).toHaveLength(8);
    expect(roomCode()).toMatch(ROOM_CODE);
    expect(gameId()).toMatch(/^g_[A-Z0-9]{10}$/);
  });

  it('makes player ids the database rules accept', () => {
    expect(isPlayerId(playerId())).toBe(true);
    expect(discordPlayerId('123456789012345678')).toBe('d_123456789012345678');
    expect(isPlayerId(discordPlayerId('123456789012345678'))).toBe(true);
    expect(isPlayerId('hacker')).toBe(false);
  });

  it('derives a fixed Discord room code from the instance id', async () => {
    const a = await discordRoomCode('instance-1');
    expect(a).toMatch(/^D[A-Z0-9]{7}$/);
    expect(a).toMatch(ROOM_CODE);
    expect(await discordRoomCode('instance-1')).toBe(a);
    expect(await discordRoomCode('instance-2')).not.toBe(a);
  });

  it('reads invite codes from #CODE or ?room=CODE', () => {
    expect(inviteCode({ hash: '#abcde', search: '' })).toBe('ABCDE');
    expect(inviteCode({ hash: '', search: '?room=xy-z12' })).toBe('XYZ12');
    expect(inviteCode({ hash: '#x', search: '' })).toBeNull();
    expect(inviteCode({ hash: '', search: '' })).toBeNull();
    expect(inviteCode(null)).toBeNull();
  });

  it('seeded random streams repeat', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});
