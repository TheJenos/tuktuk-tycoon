import { useRef, useState, type MouseEvent } from 'react';
import { AFK_STRIKES, othersPlaying } from '../../net/doc';
import type { PlayerId } from '../../net/types';
import { getBoard, type SeatId } from '../../rules';
import { ConfirmButton } from '../ConfirmButton';
import { safeColor } from '../colors';
import { MenuPanel, MenuRail, type MenuTab } from '../MenuShell';
import { useDialogFocus, useEscape } from '../useDialogFocus';
import { useBusy, useSend } from './actions';
import { useDoc, useGameSession, useMySeats, useNames, useSessionSel } from './context';
import { skillLabel } from '../lobby/seats';
import { afkText, BOT_PACE_LABELS, incomeTaxText, jailName, minutes, parkingName, supplyOf, tradingText } from '../lobby/rulesText';
import { money, startName, taxName } from './format';
import { GameSettings } from './GameSettings';
import { resignQuestion } from './selectors';
import { TokenIcon } from './tokenIcons';
import { DEFAULT_TOKEN } from '../../shared/tokens';

/** What the room's owner may do from the Players view; the App wires these to the room (none offline) */
export interface OwnerActions {
  /** Hand a human seat to a bot (the driver plays it as AFK until its player acts) */
  letBotPlay?(seat: SeatId): void | Promise<unknown>;
  /** Give a seat to a spectator */
  giveSeat?(seat: SeatId, to: PlayerId): void | Promise<unknown>;
  /** Who a seat can be given to */
  spectators?: { pid: PlayerId; name: string }[];
  kick?(seat: SeatId): void | Promise<unknown>;
  /** End the game ranked by net worth (offered when only bots are left playing) */
  finishNow?(): void | Promise<unknown>;
}

interface Props {
  onResume(): void;
  onLeave(): void;
  isOwner: boolean;
  ownerActions?: OwnerActions;
  /** My seat is played by a bot (AFK): take it back */
  onTakeBack?: (seat: SeatId) => void;
}

type View = 'game' | 'players' | 'rules' | 'settings';

/**
 * Esc: the lobby's menu over the running game (which keeps going). Game: resume, resign, leave. Players: who is
 * at the table, and the owner's seat actions. Rules: this room's rules and timers. Settings: as in the lobby.
 * Esc on another view goes back to Game; on Game it resumes, as does a click on the dimmed board.
 */
export function GameMenu({ onResume, onLeave, isOwner, ownerActions, onTakeBack }: Props) {
  const session = useGameSession();
  const doc = useDoc();
  const mine = useMySeats();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const [view, setView] = useState<View>('game');
  const root = useRef<HTMLDivElement>(null);
  useDialogFocus(root, false);
  useEscape(view === 'game' ? onResume : () => setView('game'), root);
  const owner = isOwner && !!ownerActions;
  const shown: View = view === 'players' || view === 'rules' || view === 'settings' ? view : 'game';
  const presence = useSessionSel((v) => v.presence);
  const s = doc?.game;
  const live = s ? mine.filter((seat) => s.players[seat] && !s.players[seat]?.out) : [];
  const afk = live.filter((seat) => doc?.seats[seat]?.afk);
  // Online, only once nobody else is still playing (bots, players who left or handed their seat over); offline
  // every human seat is at this device
  const othersIn = doc && session.online ? othersPlaying(doc, session.me, (seat) => presence?.[seat] === 'offline') : [];
  const canFinish = owner && !!ownerActions?.finishNow && !!s && s.phase.k !== 'over';

  const tabs: MenuTab[] = [
    { id: 'game', label: 'Game', short: 'Game', icon: '◎', sub: 'Resume, resign or leave' },
    { id: 'players', label: 'Players', short: 'Players', icon: '◈', sub: owner ? 'Seats and bots' : 'Who is at the table' },
    { id: 'rules', label: 'Rules', short: 'Rules', icon: '▤', sub: s?.cfg.speedDie ? 'Classic + Speed Die' : 'Classic' },
    { id: 'settings', label: 'Settings', short: 'Settings', icon: '⚙', sub: 'Graphics, motion, sound' },
  ];
  const titles: Record<View, string> = { game: 'This game', players: 'Players', rules: 'Rules', settings: 'Settings' };
  const backdrop = (e: MouseEvent) => {
    if ((e.target as HTMLElement).hasAttribute('data-backdrop')) onResume();
  };

  return (
    <div id="game-menu" ref={root} className="overlay pause-menu" role="dialog" aria-modal="true" aria-labelledby="game-menu-title" onClick={backdrop} data-backdrop>
      <div className="pause-frame" data-backdrop>
        <header className="menu-top pause-top" data-backdrop>
          <div className="pause-heading">
            <span className="pause-kicker">Menu</span>
            <h2 id="game-menu-title">{names.board.display.title}</h2>
          </div>
          {session.code && (
            <p className="room pause-room">
              <span className="muted">Room</span>
              <strong>{session.code}</strong>
            </p>
          )}
        </header>
        <div className="menu-body" data-backdrop>
          <MenuRail
            label="Game menu"
            tabsLabel="Game menu"
            idPrefix="game-menu-"
            hero={
              <button type="button" className="menu-play" onClick={onResume} autoFocus>
                <span className="label"><span aria-hidden="true">▶</span> Resume</span>
                <span className="sub">Back to the board</span>
              </button>
            }
            tabs={tabs}
            active={shown}
            onSelect={(id) => setView(id as View)}
          />
          <footer className="menu-foot pause-foot">
            <ConfirmButton className="danger menu-leave" question="Leave the room?" yes="Leave" no="Stay" onConfirm={onLeave}>
              <span className="icon" aria-hidden="true">↩</span>Leave room
            </ConfirmButton>
            {session.online && live.length > 0 && <p className="muted leave-note">Your seat stays: a bot plays it until you come back.</p>}
          </footer>
          <MenuPanel id={shown} idPrefix="game-menu-" title={titles[shown]}>
            {shown === 'game' && (
              <div className="menu-game">
                {s && <p>{s.phase.k === 'over' ? 'The game is over.' : `Turn ${s.turn.no}: ${names.seat(s.turn.seat)} is playing. The game goes on while this menu is open.`}</p>}
                {live.length === 0 && <p className="muted">You are watching this game.</p>}
                {afk.map((seat) => (
                  <p key={seat} className="warning">
                    A bot is playing {names.seat(seat)} for you.{' '}
                    {onTakeBack && <button type="button" onClick={() => onTakeBack(seat)}>Take back control</button>}
                  </p>
                ))}
                {s && s.phase.k !== 'over' && live.map((seat) => (
                  <div key={seat} className="menu-resign">
                    <ConfirmButton
                      className="danger"
                      disabled={busy}
                      question={resignQuestion(s, seat, names, live.length > 1)}
                      yes="Resign"
                      no="Keep playing"
                      onConfirm={() => void send(seat, { k: 'resign' })}
                    >
                      Resign{live.length > 1 ? ` ${names.seat(seat)}` : ''}
                    </ConfirmButton>
                  </div>
                ))}
                {canFinish && othersIn.length === 0 && (
                  <ConfirmButton
                    className="danger"
                    question="End the game now, ranked by net worth?"
                    yes="Finish now"
                    no="Keep going"
                    onConfirm={() => {
                      void ownerActions?.finishNow?.();
                      // The standings come up next: the menu gets out of their way
                      onResume();
                    }}
                  >
                    Finish now
                  </ConfirmButton>
                )}
                {canFinish && othersIn.length > 0 && (
                  <p className="muted small">Finish now is offered once only bots are left playing.</p>
                )}
              </div>
            )}
            {shown === 'players' && <PlayersView owner={owner} actions={ownerActions} />}
            {shown === 'rules' && <RulesView />}
            {shown === 'settings' && <GameSettings />}
          </MenuPanel>
        </div>
      </div>
    </div>
  );
}

function PlayersView({ owner, actions }: { owner: boolean; actions: OwnerActions | undefined }) {
  const doc = useDoc();
  const mine = useMySeats();
  const names = useNames();
  const [giveTo, setGiveTo] = useState<Partial<Record<SeatId, string>>>({});
  if (!doc) return null;
  const s = doc.game;
  const spectators = actions?.spectators ?? [];
  return (
    <ul className="menu-players">
      {s.order.map((seat) => {
        const info = doc.seats[seat];
        const p = s.players[seat];
        const human = info?.kind === 'human';
        const out = !!p?.out;
        const status = out ? (p?.out === 'resigned' ? 'Resigned' : 'Bankrupt') : info?.kind === 'bot' ? skillLabel(info.skill) : info?.afk ? 'Away (a bot plays)' : !info?.ctrl ? 'Left' : 'Playing';
        const target = giveTo[seat] ?? spectators[0]?.pid ?? '';
        return (
          <li key={seat}>
            <span style={{ color: safeColor(info?.color) }}>
              <TokenIcon token={info?.token ?? DEFAULT_TOKEN} color={info?.color} size={22} />
            </span>
            <span className="who">
              <strong>{names.seat(seat)}</strong>
              {mine.includes(seat) && <span className="badge accent">You</span>}
              <span className="muted small">{status}{p && !out ? ` · ${money(p.cash)}` : ''}</span>
            </span>
            {owner && human && !out && !mine.includes(seat) && (
              <span className="owner-actions">
                {actions?.letBotPlay && !info?.afk && (
                  <button type="button" onClick={() => void actions.letBotPlay?.(seat)}>Let a bot play</button>
                )}
                {actions?.giveSeat && spectators.length > 0 && (
                  <span className="give-seat">
                    <label className="sr-only" htmlFor={`give-${seat}`}>Give {names.seat(seat)}'s seat to</label>
                    <select id={`give-${seat}`} value={target} onChange={(e) => setGiveTo({ ...giveTo, [seat]: e.target.value })}>
                      {spectators.map((x) => (
                        <option key={x.pid} value={x.pid}>{x.name}</option>
                      ))}
                    </select>
                    <button type="button" disabled={!target} onClick={() => void actions.giveSeat?.(seat, target)}>Give seat</button>
                  </span>
                )}
                {actions?.kick && (
                  <ConfirmButton className="danger" question={`Remove ${names.seat(seat)}?`} yes="Kick" no="Keep" onConfirm={() => void actions.kick?.(seat)}>
                    Kick
                  </ConfirmButton>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const secs = (n: number) => (n > 0 ? `${n} s` : 'off');

function RulesView() {
  const doc = useDoc();
  const session = useGameSession();
  if (!doc) return null;
  const c = doc.game.cfg;
  const t = doc.timers;
  const b = getBoard(c.board);
  const online = session.online;
  const rows: [string, string][] = [
    ['Board', b.display.name],
    ['Rules', c.speedDie ? 'Classic with the Speed Die' : 'Classic'],
    ['Starting cash', `${money(c.startCash)}${c.speedDie ? ` + ${money(c.speedBonus)} (Speed Die)` : ''}`],
    [`${startName(b)} salary`, c.doubleGoLanding ? `${money(c.goSalary)}, ${money(c.goSalary * 2)} for landing on it` : money(c.goSalary)],
    [taxName(b, 'income'), incomeTaxText(c)],
    [taxName(b, 'luxury'), money(c.luxuryTax)],
    [`${parkingName(b)} jackpot`, c.jackpot ? `On: ${money(doc.game.pot)} waiting` : 'Off'],
    ['Jail fine', money(c.jailFine)],
    ['Bank stock', supplyOf(c) === 'unlimited' ? 'Unlimited houses and hotels' : `${c.houses} houses, ${c.hotels} hotels`],
    ['Mortgage interest', `${c.mortgagePct}%`],
    ...(c.speedDie ? [['Triples', c.triplesRollAgain ? 'Move anywhere, then roll again' : 'Move anywhere'] as [string, string]] : []),
    ['Three doubles', c.threeDoublesJail ? `Go to the ${jailName(b)}` : 'Just roll again'],
    ['Auctions', c.auctionAll ? 'Every property: nobody buys at the printed price' : c.auctions ? 'Property nobody buys is auctioned' : 'Off: property nobody buys stays with the bank'],
    ['First lap', c.buyAfterFirstLap ? `No buying until you have passed ${startName(b)} once` : 'Buy from the start'],
    ['Rent while in jail', c.jailRent ? 'Collected' : 'Not collected'],
    ['Quick-start deal', c.dealProperties > 0 ? `${c.dealProperties} free propert${c.dealProperties === 1 ? 'y' : 'ies'} each` : 'None'],
    ['Trading', tradingText(c)],
    ['Game ends', c.endMode === 'firstBankrupt' ? 'At the first bankruptcy, ranked by net worth' : 'When one player is left'],
    ['Turn limit', c.turnLimit > 0 ? `${c.turnLimit} turns, then ranked by net worth` : 'None'],
    ['Time limit', doc.timeLimit ? `${minutes(doc.timeLimit)}, then ranked by net worth` : 'None'],
    ['Turn timer', secs(t.turn)],
    ['Decision timer', secs(t.decision)],
    ['Auction countdown', `${secs(t.auction)} from the start (bids don't add time)`],
    ['Debt timer', secs(t.debt)],
    ['Bot speed', BOT_PACE_LABELS[doc.botPace ?? 1] ?? 'Normal'],
    ...(online ? [
      ['A bot plays for an absent player', afkText(doc.afkStrikes ?? AFK_STRIKES)] as [string, string],
      ['Bots for absent players play at', skillLabel(doc.botSkill)] as [string, string],
    ] : []),
  ];
  return (
    <>
      <dl className="rules-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">
        Rent is collected automatically.{doc.game.cfg.auctions ? ' Auctions are open bidding: anyone still in may raise at any time.' : ''}
      </p>
    </>
  );
}
