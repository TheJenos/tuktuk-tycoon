import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { LANKA } from '../../rules';
import { kinematicThrow, randomQuat } from '../dice/kinematic';
import { correction, faceFor, HERO_FACES, landedFace, restingQuat, upness, WHITE_FACES } from '../dice/remap';
import { loadRapier, simulateThrow } from '../dice/simulate';
import { seeded } from '../util/random';

describe('dice remap', () => {
  it('puts the target face up for all 6 x 6 landed/target pairs', () => {
    const rand = seeded(42);
    for (let landed = 0; landed < 6; landed++) {
      for (let target = 0; target < 6; target++) {
        for (let k = 0; k < 8; k++) {
          // A body resting on face `landed`, turned about the vertical and slightly tilted, as a simulation ends
          const body = restingQuat(landed, rand() * Math.PI * 2);
          const tilt = new Quaternion().setFromAxisAngle(new Vector3(rand(), 0, rand()).normalize(), (rand() - 0.5) * 0.2);
          body.premultiply(tilt);
          expect(landedFace(body)).toBe(landed);
          const visual = body.clone().multiply(correction(landed, target));
          expect(landedFace(visual), `landed ${landed} target ${target}`).toBe(target);
          expect(upness(visual, target)).toBeGreaterThan(0.99);
        }
      }
    }
  });

  it('only ever uses one of the cube symmetries', () => {
    for (let landed = 0; landed < 6; landed++) {
      for (let target = 0; target < 6; target++) {
        const c = correction(landed, target);
        // Every axis maps onto an axis (no in-between rotation that would show a tilted cube)
        for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
          const v = axis.applyQuaternion(c);
          expect(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z))).toBeCloseTo(1, 6);
        }
      }
    }
  });

  it('maps values to faces, preferring the face already up for a repeated value', () => {
    expect(WHITE_FACES.slice().sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (let v = 1; v <= 6; v++) expect(WHITE_FACES[faceFor(WHITE_FACES, v)]).toBe(v);
    const faces = LANKA.speedDie.faces;
    const both = faces.flatMap((f, i) => (f === 'uncle' ? [i] : []));
    expect(both.length).toBe(2);
    expect(faceFor(faces, 'uncle', both[1])).toBe(both[1]);
    expect(faces[faceFor(faces, 'uncle', 0)]).toBe('uncle');
    expect(faces[faceFor(faces, 'bus')]).toBe('bus');
    // The Hero die: every face value 1-6 (a hero, in the heroes' order) on one face, opposite faces adding up to 7
    expect(HERO_FACES.slice().sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (let v = 1; v <= 6; v++) expect(HERO_FACES[faceFor(HERO_FACES, v)]).toBe(v);
    for (const [a, b] of [[0, 1], [2, 3], [4, 5]] as const) expect(HERO_FACES[a]! + HERO_FACES[b]!).toBe(7);
  });

  it('the kinematic throw ends at rest on the wanted face', () => {
    const rand = seeded(7);
    for (let face = 0; face < 6; face++) {
      const t = kinematicThrow(rand, new Vector3(1, 3, 3), new Vector3(0, 0.41, 0), face);
      const pos = new Vector3();
      const q = new Quaternion();
      t.sample(1, pos, q);
      expect(pos.distanceTo(new Vector3(0, 0.41, 0))).toBeLessThan(1e-6);
      expect(landedFace(q)).toBe(face);
      expect(upness(q, face)).toBeGreaterThan(0.9999);
      t.sample(0.2, pos, q);
      expect(pos.y).toBeGreaterThan(0.41);
    }
    const q = randomQuat(seeded(3));
    expect(q.length()).toBeCloseTo(1, 6);
  });
});

describe('dice physics (Rapier, Node build)', () => {
  it('records throws that settle flat, and the remap lands every value', async () => {
    const R = await loadRapier();
    let frames = 0;
    let made = 0;
    for (let seed = 1; seed <= 24; seed++) {
      // Two white dice, with the Speed Die, or the Hero die thrown alone
      const count = seed % 4 === 0 ? 1 : seed % 3 === 0 ? 3 : 2;
      const rec = simulateThrow(R, count, seed * 7919);
      if (!rec) continue;
      made++;
      frames = Math.max(frames, rec.frames);
      for (let d = 0; d < count; d++) {
        const track = rec.tracks[d] as Float32Array;
        const o = (rec.frames - 1) * 7;
        const body = new Quaternion(track[o + 3], track[o + 4], track[o + 5], track[o + 6]);
        expect(landedFace(body)).toBe(rec.landed[d]);
        const target = (seed + d) % 6;
        const visual = body.clone().multiply(correction(rec.landed[d] as number, target));
        expect(landedFace(visual)).toBe(target);
        expect(upness(visual, target)).toBeGreaterThan(0.97);
      }
    }
    // Retries make a failed throw rare; and every throw settles within the playback cap.
    expect(made).toBeGreaterThanOrEqual(22);
    expect(frames).toBeLessThanOrEqual(360);
  });
});
