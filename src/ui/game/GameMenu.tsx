import { useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { AFK_STRIKES, othersPlaying } from '../../net/doc';
import type { PlayerId } from '../../net/types';
import { getBoard, heroesOf, type SeatId } from '../../rules';
import { phaseSecs } from '../../shared/timing';
import { ConfirmButton } from '../ConfirmButton';
import { safeColor } from '../colors';
import { MenuPanel, MenuRail, type MenuTab } from '../MenuShell';
import { useDialogFocus, useEscape } from '../useDialogFocus';
import { useBusy, useSend } from './actions';
import { useDoc, useGameSession, useMySeats, useNames, useSessionSel } from './context';
import { skillLabel } from '../lobby/seats';
import { afkText, BOT_PACE_LABELS, hiddenOptions, incomeTaxText, jailName, minutes, parkingName, supplyOf, tradingText, type RulesDraft } from '../lobby/rulesText';
import { capital, pluralWord, startName, taxName, tokenOf } from './format';
import { GameSettings } from './GameSettings';
import { resignQuestion } from './selectors';
import { TokenIcon } from './tokenIcons';
import './heroes.css';

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
    { id: 'rules', label: 'Rules', short: 'Rules', icon: '▤', sub: names.board.heroes ? names.board.display.name : s?.cfg.speedDie ? 'Classic + Speed Die' : 'Classic' },
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
                    question={`End the game now, ranked by ${names.terms.worth}?`}
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
              <TokenIcon token={tokenOf(s, seat, info?.token)} color={info?.color} size={22} />
            </span>
            <span className="who">
              <strong>{names.seat(seat)}</strong>
              {mine.includes(seat) && <span className="badge accent">You</span>}
              <span className="muted small">{status}{p?.hero ? ` · ${names.hero(p.hero)}` : ''}{p && !out ? ` · ${names.money(p.cash)}` : ''}</span>
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

/** One line of the rules list, with the room option it shows (left out where the board pins it or has no use for it) */
type RuleRow = [label: string, value: string, option?: keyof RulesDraft];

function RulesView() {
  const doc = useDoc();
  const session = useGameSession();
  const names = useNames();
  if (!doc) return null;
  const c = doc.game.cfg;
  const t = doc.timers;
  const b = getBoard(c.board);
  const online = session.online;
  const money = names.money;
  const { worth, property, bought, rent } = names.terms;
  const heroes = !!b.heroes;
  const hidden = hiddenOptions(c.board);
  const rows: RuleRow[] = [
    ['Board', b.display.name],
    ['Rules', heroes ? (b.display.rulesBlurb ?? b.display.name) : c.speedDie ? 'Classic with the Speed Die' : 'Classic'],
    [heroes ? 'Starting Power' : 'Starting cash', `${money(c.startCash)}${c.speedDie ? ` + ${money(c.speedBonus)} (Speed Die)` : ''}`, 'startCash'],
    [`${startName(b)} salary`, c.doubleGoLanding ? `${money(c.goSalary)}, ${money(c.goSalary * 2)} for landing on it` : money(c.goSalary), 'goSalary'],
    [taxName(b, 'income'), incomeTaxText(c), 'incomeTaxMode'],
    [taxName(b, 'luxury'), money(c.luxuryTax), 'luxuryTax'],
    [`${parkingName(b)} jackpot`, c.jackpot ? `On: ${money(doc.game.pot)} waiting` : 'Off', 'jackpot'],
    [heroes ? `${jailName(b)} fine` : 'Jail fine', heroes ? `${money(c.jailFine)}, paid at the start of the next turn` : money(c.jailFine), 'jailFine'],
    ['Bank stock', supplyOf(c) === 'unlimited' ? 'Unlimited houses and hotels' : `${c.houses} houses, ${c.hotels} hotels`, 'houses'],
    ['Mortgage interest', `${c.mortgagePct}%`, 'mortgagePct'],
    ...(c.speedDie ? [['Triples', c.triplesRollAgain ? 'Move anywhere, then roll again' : 'Move anywhere', 'triplesRollAgain'] as RuleRow] : []),
    ['Three doubles', c.threeDoublesJail ? `Go to the ${jailName(b)}` : 'Just roll again', 'threeDoublesJail'],
    ['Auctions', c.auctionAll ? 'Every property: nobody buys at the printed price' : c.auctions ? 'Property nobody buys is auctioned' : 'Off: property nobody buys stays with the bank', 'auctions'],
    ['First lap', c.buyAfterFirstLap ? `No buying until you have passed ${startName(b)} once` : 'Buy from the start', 'buyAfterFirstLap'],
    ['Rent while in jail', c.jailRent ? 'Collected' : 'Not collected', 'jailRent'],
    ['Quick-start deal', c.dealProperties > 0 ? `${c.dealProperties} free propert${c.dealProperties === 1 ? 'y' : 'ies'} each` : 'None', 'dealProperties'],
    ['Trading', tradingText(c), 'trading'],
    heroes
      ? ['Game ends', `When every ${property} is ${bought}, ranked by ${worth}: your Power plus ${b.heroes?.locationPoints ?? 0} for each ${property}`]
      : ['Game ends', c.endMode === 'firstBankrupt' ? 'At the first bankruptcy, ranked by net worth' : 'When one player is left', 'endMode'],
    ['Turn limit', c.turnLimit > 0 ? `${c.turnLimit} turns, then ranked by ${worth}` : 'None', 'turnLimit'],
    ['Time limit', doc.timeLimit ? `${minutes(doc.timeLimit)}, then ranked by ${worth}` : 'None'],
    ['Turn timer', secs(t.turn), 'turnTimer'],
    ['Decision timer', secs(t.decision), 'decisionTimer'],
    ...(heroes ? [['Reaction window', `${secs(phaseSecs('reaction', t))} after the throw lands`] as RuleRow] : []),
    ['Auction countdown', `${secs(t.auction)} from the start (bids don't add time)`, 'auctionTimer'],
    ['Debt timer', secs(t.debt), 'debtTimer'],
    ['Bot speed', BOT_PACE_LABELS[doc.botPace ?? 1] ?? 'Normal'],
    ...(online ? [
      ['A bot plays for an absent player', afkText(doc.afkStrikes ?? AFK_STRIKES)] as RuleRow,
      ['Bots for absent players play at', skillLabel(doc.botSkill)] as RuleRow,
    ] : []),
  ];
  const shown = rows.filter(([, , option]) => !option || !hidden.has(option));
  return (
    <>
      <dl className="rules-list">
        {shown.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {heroes ? (
        <>
          <p className="muted small">
            Saving is compulsory: land on a {property} a villain holds with the Power for it and you {names.terms.buy} it; if you can't, another
            hero may (the back-up hero). {capital(pluralWord(rent))} are paid automatically, doubled for a colour pair. Short of Power, you pay what you
            have and the rest is forgiven: nobody goes bankrupt.
          </p>
          <ul className="rules-heroes" aria-label="Heroes">
            {heroesOf(b).map((h) => {
              const seat = names.heroSeat(h.id);
              return (
                <li key={h.id} style={{ '--hero': safeColor(h.colour) } as CSSProperties}>
                  <strong>{h.name}</strong>{seat ? ` (${names.seat(seat)})` : ''}: <strong>{h.powerName}</strong>. {h.powerText}
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Each superpower is used once, then ready again with the next {startName(b)} salary (not in the turn it was used) or a Recharge card.
          </p>
        </>
      ) : (
        <p className="muted small">
          Rent is collected automatically.{doc.game.cfg.auctions ? ' Auctions are open bidding: anyone still in may raise at any time.' : ''}
        </p>
      )}
    </>
  );
}
