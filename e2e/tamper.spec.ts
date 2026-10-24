import type { StateRecord } from '../src/net/session';
import type { Doc } from '../src/net/types';
import { db } from './support/db';
import { expect, needsEmulator, test } from './support/fixtures';
import { hud } from './support/play';
import { roomPosition } from './support/positions';

/*
 * Every client replays each move it receives through the rules: a move written to the database that the rules
 * don't give (here, ending a turn before rolling, with Rs. 350,000 more for the mover) shows the tamper banner on every
 * screen, naming the move and who it claims to be from.
 */

needsEmulator();

test('a move the rules refuse, written straight to the database, shows the tamper banner on both screens', async ({ table }) => {
  const { code, alice, bob } = await table({ position: (setup) => roomPosition(setup) });
  const rec = (await db.get<StateRecord>(`rooms/${code}/state`))!;
  const doc = JSON.parse(rec.data) as Doc;
  const s0 = doc.game.players.s0!;
  const seq = doc.seq + 1;
  const forged: Doc = {
    ...doc,
    seq,
    game: { ...doc.game, seq, players: { ...doc.game.players, s0: { ...s0, cash: s0.cash + 3500 } } },
    ids: [...doc.ids, 'TAMPER01'],
    recent: [...doc.recent, { id: 'TAMPER01', pid: await alice.id(), at: Date.now(), cmd: { by: 's0', a: { k: 'endTurn' } } }],
  };
  await db.put(`rooms/${code}/state`, { ...rec, seq, at: Math.max(rec.at, Date.now()), data: JSON.stringify(forged) });

  for (const p of [alice, bob]) {
    await expect(hud(p.page).getByRole('alert').filter({ hasText: 'broke the rules' })).toContainText(`Move ${seq} by ${alice.name} broke the rules`);
  }
});
