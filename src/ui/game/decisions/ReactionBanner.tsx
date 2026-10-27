import { useEffect, useRef } from 'react';
import { usablePowers, type ReactPhase, type SeatId } from '../../../rules';
import { useIdle } from '../../../view';
import { settings, useSettings } from '../../settings';
import { useBusy, useSend } from '../actions';
import { useDoc, useGame, useGameSession, useMySeats, useNames } from '../context';
import { powerLabel, powerName } from '../format';
import { TimerBar } from '../hud/TimerRing';
import { activeDeadline, askReaction, myAwaited, phaseLabel, reactAbout } from '../selectors';
import { Prompt } from './Prompt';
import '../heroes.css';

/*
 * Hero League's reaction windows (docs/heroes.md): after a throw anyone who can use Thunder Call may have it
 * re-rolled, and before a Villain Strike effect or a Titan Smash aimed at a hero that hero may say no with Star
 * Shield. The banner says what is being reacted to, with a row per local seat the window asks; the Reactions setting
 * decides which windows ask (the others are passed at once, useReactionAutoPass). Hot-seat passes no device for it.
 */

export function ReactionBanner({ seats }: { seats: SeatId[] }) {
  const s = useGame();
  const names = useNames();
  // Hot-seat names each reactor (the device may be in anyone's hands)
  const many = useMySeats().length > 1;
  const { reactions } = useSettings();
  if (!s || s.phase.k !== 'react') return null;
  const ph = s.phase;
  const asked = seats.filter((seat) => askReaction(s, seat, reactions));
  if (!asked.length) return null;
  const about = reactAbout(s, names, ph);
  const power = ph.kind === 'thunder' ? 'thunder' : 'shield';
  return (
    <Prompt title={`${powerName(names.board, power)}?`} className="reaction-banner">
      <div className="react-about" aria-live="polite">
        <strong>{about.title}</strong>
        <span className="muted small">{about.detail}</span>
      </div>
      {asked.map((seat) => (
        <ReactRow key={seat} seat={seat} ph={ph} many={many} />
      ))}
      <label className="react-mine">
        <input
          type="checkbox"
          checked={reactions === 'mine'}
          onChange={(e) => settings.update({ reactions: e.target.checked ? 'mine' : 'all' })}
        />
        <span>Only ask on my throws</span>
      </label>
    </Prompt>
  );
}

/**
 * One reactor's answer. Pass comes first: it is where focus lands and what the countdown plays when it runs out (no
 * button is the primary one, so a stray Enter never spends a superpower).
 */
function ReactRow({ seat, ph, many }: { seat: SeatId; ph: ReactPhase; many: boolean }) {
  const s = useGame();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  if (!s) return null;
  const thunder = ph.kind === 'thunder';
  const use = usablePowers(s, seat).find((u) => u.power === (thunder ? 'thunder' : 'shield'));
  const name = names.seat(seat);
  const hero = names.hero(s.players[seat]?.hero ?? '');
  const at = s.since;
  const via = powerLabel(names.board, thunder ? 'thunder' : 'shield', use?.copied);
  return (
    <div className="react-row" role="group" aria-label={many ? `Reaction for ${name}` : 'Your reaction'}>
      {many && (
        <strong>
          {name} <span className="muted small">({hero})</span>
        </strong>
      )}
      <div className="action-row">
        <button type="button" disabled={busy} onClick={() => void send(seat, { k: 'pass', at })}>
          Pass
        </button>
        <button
          type="button"
          className="power-use"
          disabled={busy || !use}
          title={thunder ? 'Throw again: the new throw stands' : 'Say no: the effect does not happen'}
          onClick={() => void send(seat, thunder ? { k: 'reroll', at } : { k: 'shield', at })}
        >
          {thunder ? 'Re-roll' : 'Shield'}
          <small>{via}</small>
        </button>
      </div>
    </div>
  );
}

/**
 * A reaction window none of my seats is asked in (I'm not in it, or the setting passes for me): what it is about,
 * who may answer and the countdown, in the context column. Only once the board has shown the throw.
 */
export function ReactionStatus() {
  const s = useGame();
  const doc = useDoc();
  const names = useNames();
  const mine = useMySeats();
  const idle = useIdle();
  const { reactions } = useSettings();
  if (!s || s.phase.k !== 'react' || !idle) return null;
  if (myAwaited(s, mine).some((seat) => askReaction(s, seat, reactions))) return null;
  const about = reactAbout(s, names, s.phase);
  const deadline = activeDeadline(doc);
  return (
    <section className="prompt panel reaction-status" aria-label="Reaction window">
      <p>
        <strong>{about.title}</strong>
      </p>
      <p className="muted small">{phaseLabel(s, names, mine)}</p>
      {deadline && <TimerBar deadline={deadline} label="Time to react" />}
    </section>
  );
}

/**
 * Passes at once for my seats a reaction window should not ask (the Reactions setting: only my throws, or never).
 * Once per window and seat; a seat a bot is playing for me (AFK) is left to the bot. Quietly: a pass that arrives
 * after the window closed (another answer got there first) is refused as stale, which says nothing worth a toast.
 */
export function useReactionAutoPass(): void {
  const s = useGame();
  const doc = useDoc();
  const mine = useMySeats();
  const session = useGameSession();
  const { reactions } = useSettings();
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (!s || s.phase.k !== 'react') return;
    for (const seat of myAwaited(s, mine)) {
      if (doc?.seats[seat]?.afk || askReaction(s, seat, reactions)) continue;
      const key = `${s.since}:${seat}`;
      if (sent.current.has(key)) continue;
      sent.current.add(key);
      session.dispatch(seat, { k: 'pass', at: s.since }).catch(() => {});
    }
  }, [s, doc, mine, session, reactions]);
}
