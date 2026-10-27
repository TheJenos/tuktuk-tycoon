import { useState } from 'react';
import type { BotSkill } from '../../net/types';
import { isValidName } from '../playerName';
import { ColorPicker, SeatToken, TokenPicker } from './TokenPicker';
import { getBoard } from '../../rules';
import { addSeat, maxSeatsFor, MIN_SEATS, SKILLS, type SeatDraft } from './seats';

/*
 * The local game's table: you, more players taking turns at this screen (hot-seat), and bots with a level each.
 * Every seat has a token and a colour nobody else at the table has.
 */

/** What stops this table from starting on `board`, if anything */
export function seatsProblem(seats: SeatDraft[], board = 'lanka'): string | null {
  if (seats.length < MIN_SEATS) return `A game needs at least ${MIN_SEATS} players.`;
  const max = maxSeatsFor(board);
  if (seats.length > max) return `${getBoard(board).display.name} seats at most ${max}: remove ${seats.length - max}.`;
  const names = new Set<string>();
  for (const s of seats) {
    const name = s.name.trim();
    if (s.kind !== 'bot' && !isValidName(name)) return `“${name || 'A player'}” needs a name of 2–16 letters, numbers, spaces, - or _.`;
    if (names.has(name.toLowerCase())) return `Two players are called ${name}.`;
    names.add(name.toLowerCase());
  }
  return null;
}

export function SeatsEditor({ seats, onChange, botSkill = 'normal', board = 'lanka' }: {
  seats: SeatDraft[];
  onChange(seats: SeatDraft[]): void;
  /** The board: how many it seats, its tokens and its bots' names */
  board?: string;
  /** The level a new bot starts at (the rules' default bot level) */
  botSkill?: BotSkill;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const set = (key: number, patch: Partial<SeatDraft>) => onChange(seats.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const remove = (key: number) => onChange(seats.filter((s) => s.key !== key));
  const max = maxSeatsFor(board);
  const full = seats.length >= max;
  const humans = seats.filter((s) => s.kind !== 'bot').length;

  return (
    <div className="lobby-form seats-editor">
      <p className="muted lobby-lead">
        {seats.length} of {max} seats{board !== 'lanka' ? ` (${getBoard(board).display.name} seats ${max})` : ''}.{' '}
        {humans > 1 ? 'Players at this screen take turns: the game says whose move it is.' : 'Add players to take turns at this screen, or bots to play against.'}
      </p>
      <ul className="seat-rows">
        {seats.map((s, i) => {
          const others = seats.filter((x) => x.key !== s.key);
          const who = s.kind === 'you' ? 'You' : s.kind === 'bot' ? s.name : s.name.trim() || `Player ${i + 1}`;
          return (
            <li key={s.key} className={`seat-row ${s.kind}`}>
              <div className="seat-row-main">
                <button
                  type="button"
                  className="seat-token-button"
                  aria-expanded={open === s.key}
                  aria-label={`Token and colour for ${who}`}
                  title="Token and colour"
                  onClick={() => setOpen(open === s.key ? null : s.key)}
                >
                  <SeatToken token={s.token} color={s.color} />
                </button>
                {s.kind === 'bot' ? (
                  <span className="seat-name">
                    <strong>{s.name}</strong>
                    <span className="badge bot">Bot</span>
                  </span>
                ) : s.kind === 'you' ? (
                  <span className="seat-name">
                    <strong>{s.name}</strong>
                    <span className="badge accent">You</span>
                  </span>
                ) : (
                  <label className="seat-name">
                    <span className="sr-only">Name of player {i + 1}</span>
                    <input
                      value={s.name}
                      maxLength={16}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={!isValidName(s.name.trim())}
                      onChange={(e) => set(s.key, { name: e.target.value })}
                    />
                  </label>
                )}
                {s.kind === 'bot' && (
                  <label className="seat-skill">
                    <span className="sr-only">{s.name}'s level</span>
                    <select value={s.skill} onChange={(e) => set(s.key, { skill: e.target.value as BotSkill })}>
                      {SKILLS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                  </label>
                )}
                {s.kind !== 'you' && (
                  <button
                    type="button"
                    className="icon-button seat-remove"
                    aria-label={`Remove ${who}`}
                    title="Remove"
                    disabled={seats.length <= MIN_SEATS}
                    onClick={() => remove(s.key)}
                  >
                    ✕
                  </button>
                )}
              </div>
              {open === s.key && (
                <div className="seat-row-pickers">
                  <TokenPicker board={board} label={`${who}: token`} value={s.token} color={s.color} taken={others.map((x) => x.token)} onPick={(token) => set(s.key, { token })} />
                  <ColorPicker label={`${who}: colour`} value={s.color} taken={others.map((x) => x.color)} onPick={(color) => set(s.key, { color })} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="seat-add">
        <button type="button" disabled={full} onClick={() => onChange(addSeat(seats, 'human', 'normal', board))}>＋ Add a player</button>
        <button type="button" disabled={full} onClick={() => onChange(addSeat(seats, 'bot', botSkill, board))}>＋ Add a bot</button>
        {full && <span className="muted">The table is full.</span>}
      </div>
    </div>
  );
}
