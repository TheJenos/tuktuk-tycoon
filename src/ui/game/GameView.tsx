import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { toggleMute } from '../../audio';
import type { GameSession } from '../../net/types';
import { boardOf, type SeatId } from '../../rules';
// The camera's Recenter switch only: it doesn't pull in the 3D scene
import { recenter } from '../../scene/camera/recenter';
import { shallowEqual, useSelector, useStore } from '../../state/store';
import { uiStore, type UiState } from '../../state/ui';
import { connectDirector, useIdle } from '../../view';
import { useSettings } from '../settings';
import { installGameHooks } from '../testHooks';
import { inflight, send, toast } from './actions';
import { priceOf } from './format';
import { GameSessionProvider, useDoc, useMySeats, useSessionSel } from './context';
import { AuctionModal } from './decisions/AuctionModal';
import { CardModal } from './decisions/CardModal';
import { AuctionStatus, Decisions, promptUp } from './decisions/Decisions';
import { GameOver } from './decisions/GameOver';
import { PassDevice } from './decisions/PassDevice';
import { TileInspector } from './deeds/TileInspector';
import { GameMenu, type OwnerActions } from './GameMenu';
import { hotSeatCards } from './hotSeat';
import { ActionBar } from './hud/ActionBar';
import { BoardCenter, usePhoneLayout } from './hud/BoardCenter';
import { DiceReadout } from './hud/DiceReadout';
import { EventLog } from './hud/EventLog';
import { MyProperties } from './hud/MyProperties';
import { PlayersPanel } from './hud/PlayersPanel';
import { Announcer, Toasts } from './hud/Toasts';
import { TurnBar } from './hud/TurnBar';
import { fitUiScale, insetsFrom, isTypingTarget, sameInsets, shortcutOf, type Shortcut } from './layout';
import { ManageProperties } from './manage/ManageProperties';
import { MiniBoard } from './MiniBoard';
import { actingSeat, decisionKey, decisionSeat, gateDecision, handOver, myBidders, tradeLock, type HandOver } from './selectors';
import { TableStatus } from './hud/TableStatus';
import { TradeBuilder, type TradeDraft } from './trade/TradeBuilder';
import { TradeOffers } from './trade/TradeOffer';

export interface GameViewProps {
  session: GameSession;
  /** Leave the room (Game menu → Leave room, Game over → Back to lobby) */
  onLeave(): void;
  /** Start a rematch; shown to the room's owner when the game is over */
  onRematch?: () => void;
  isOwner?: boolean;
  /** The owner's seat actions in the Players view */
  ownerActions?: OwnerActions;
  /** Take an AFK seat of mine back from the bot */
  onTakeBack?: (seat: SeatId) => void;
  /** Late join (online, spectators): the seats I could take over, and taking one */
  lateJoin?: { seats: SeatId[]; take(seat: SeatId): void };
}

/**
 * The whole in-game DOM layer over the 3D board: players on the left, offers and log on the right, the turn bar on
 * top, the action bar at the bottom (a bottom sheet on phones), Roll / End turn and my decisions over the middle of
 * the board (the decisions join the bottom sheet on phones), plus the dialogs. Every
 * action is here, so the game plays without WebGL (the MiniBoard stands in for the board).
 */
export function GameView(props: GameViewProps) {
  return (
    <GameSessionProvider value={props.session}>
      <GameScreen {...props} />
    </GameSessionProvider>
  );
}

const uiSel = (u: UiState) => ({ panel: u.panel, selected: u.selected, gl: u.gl });

function GameScreen({ session, onLeave, onRematch, isOwner = false, ownerActions, onTakeBack, lateJoin }: GameViewProps) {
  useEffect(() => connectDirector(session), [session]);
  useEffect(() => installGameHooks(session), [session]);
  // Nothing of the last game's pickers or panels carries over
  useEffect(() => () => uiStore.update({ picker: null, selected: null, preview: null, panel: null, hover: null }), []);

  const doc = useDoc();
  const s = doc?.game ?? null;
  const mine = useMySeats();
  const idle = useIdle();
  const connected = useSessionSel((v) => v.connected);
  const tamper = useSessionSel((v) => v.tamper);
  const ui = useSelector(uiStore, uiSel, shallowEqual);
  const { uiScale } = useSettings();
  const scale = useFittedScale(uiScale);

  // A decision appears once the board has caught up, and stays while it is open
  const key = decisionKey(s, mine);
  const lastShown = useRef<string | null>(null);
  const gated = gateDecision(lastShown.current, key, idle);
  useEffect(() => {
    lastShown.current = gated;
  });

  // Hot-seat: a decision for a different local seat than the last one waits behind a "Pass to" card. Worked out
  // while rendering, so the next player's prompt never flashes up first.
  const cards = useStore(hotSeatCards);
  const actor = mine.length > 1 ? decisionSeat(s, mine, gated) : null;
  const [hand, setHand] = useState<HandOver>({ last: null, pass: null });
  const nextHand = handOver(hand, actor, cards);
  if (nextHand !== hand) setHand(nextHand);
  const passing = nextHand.pass !== null && nextHand.pass === actor ? nextHand.pass : null;
  const shown = passing ? null : gated;

  const phase = s?.phase.k;
  const seat = phase === 'over' ? null : actingSeat(s, mine);
  const turnSeat = shown && s && (phase === 'preRoll' || phase === 'postRoll') && mine.includes(s.turn.seat) ? s.turn.seat : null;
  const bidders = shown && s && phase === 'auction' ? myBidders(s, mine) : [];
  const over = shown === 'over';
  const phone = usePhoneLayout();

  const [manageSeat, setManageSeat] = useState<SeatId | null>(null);
  const [trade, setTrade] = useState<{ seat: SeatId; draft?: TradeDraft; n: number } | null>(null);
  const [mini, setMini] = useState(false);

  const openManage = useCallback((x: SeatId | null) => {
    if (!x) return;
    setManageSeat(x);
    uiStore.update({ panel: 'manage' });
  }, []);
  const openTrade = useCallback((x: SeatId | null, draft?: TradeDraft) => {
    if (!x) return;
    setTrade((t) => ({ seat: x, ...(draft ? { draft } : {}), n: (t?.n ?? 0) + 1 }));
    uiStore.update({ panel: 'trade' });
  }, []);
  const closePanel = useCallback(() => uiStore.update({ panel: null }), []);
  const toggleLog = useCallback(() => uiStore.update({ panel: uiStore.get().panel === 'log' ? null : 'log' }), []);
  const toggleProps = useCallback(() => uiStore.update({ panel: uiStore.get().panel === 'props' ? null : 'props' }), []);
  const openMenu = useCallback(() => uiStore.update({ panel: 'menu' }), []);
  // Decisions sit over the middle of the board, or in the bottom sheet on phones (the board stays in sight)
  const decision = promptUp(phase, shown) ? <Decisions shown={shown} mine={mine} onManage={openManage} onTrade={openTrade} /> : null;

  const menuOpen = ui.panel === 'menu';
  const inspecting = ui.selected !== null;
  const manageOpen = ui.panel === 'manage' && !!manageSeat && !!s?.players[manageSeat] && !s.players[manageSeat]?.out;
  const tradeOpen = ui.panel === 'trade' && !!trade;
  const glOk = ui.gl === 'ok';

  // Keyboard shortcuts, only with no dialog up and no text field focused. The latest handlers, without
  // re-adding the listener on every render.
  const keys = useRef<Partial<Record<Shortcut, () => void>>>({});
  const turn = (a: 'roll' | 'endTurn') => {
    if (turnSeat && phase === (a === 'roll' ? 'preRoll' : 'postRoll')) void send(session, turnSeat, { k: a });
  };
  const buyDecision = shown && s?.phase.k === 'buy' && mine.includes(s.turn.seat) ? s : null;
  keys.current = {
    roll: () => turn('roll'),
    endTurn: () => turn('endTurn'),
    buy: () => {
      if (!buyDecision || buyDecision.phase.k !== 'buy') return;
      const cash = buyDecision.players[buyDecision.turn.seat]?.cash ?? 0;
      if (cash >= priceOf(boardOf(buyDecision), buyDecision.phase.space)) void send(session, buyDecision.turn.seat, { k: 'buy' });
    },
    auction: () => {
      if (buyDecision) void send(session, buyDecision.turn.seat, { k: 'decline' });
    },
    manage: () => openManage(seat),
    trade: () => {
      if (!tradeLock(s, seat)) openTrade(seat);
    },
    log: toggleLog,
    recenter,
    mute: () => toast(toggleMute() ? 'Sound on (N to mute)' : 'Sound off (N to turn it back on)', 'info', 2500),
    menu: openMenu,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const sc = shortcutOf(e);
      if (!sc || isTypingTarget(document.activeElement as HTMLElement | null)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const run = keys.current[sc];
      if (!run) return;
      // Game moves wait for the one in flight; panels and the camera don't need to
      if ((sc === 'roll' || sc === 'endTurn' || sc === 'buy' || sc === 'auction') && inflight.get() > 0) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The panels' footprint, so the camera frames the board in the space left free. Panels that come and go (the
  // trade dialog, a preview card) are picked up as they are added, or move (a new data-inset value).
  const hud = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = hud.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    let observed = new Set<HTMLElement>();
    const measure = () => {
      const items = [...observed].map((el) => ({ edge: getComputedStyle(el).getPropertyValue('--edge').trim(), rect: el.getBoundingClientRect() }));
      const next = insetsFrom(items, window.innerWidth, window.innerHeight);
      if (!sameInsets(next, uiStore.get().insets)) uiStore.update({ insets: next });
    };
    const ro = new ResizeObserver(measure);
    const scan = () => {
      const now = new Set(root.querySelectorAll<HTMLElement>('[data-inset]'));
      for (const el of observed) if (!now.has(el)) ro.unobserve(el);
      for (const el of now) if (!observed.has(el)) ro.observe(el);
      observed = now;
      measure();
    };
    let frame = 0;
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        scan();
      });
    });
    mo?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-inset'] });
    window.addEventListener('resize', measure);
    scan();
    return () => {
      ro.disconnect();
      mo?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [doc === null]);

  const classes = ['game-hud', menuOpen && 'paused', ui.panel === 'log' && 'log-open', ui.panel === 'props' && 'props-open', (!glOk || mini) && 'mini-on'].filter(Boolean).join(' ');
  return (
    <div id="hud" ref={hud} className={classes} style={{ '--ui-scale': scale } as CSSProperties}>
      <Announcer />
      {!doc ? (
        <div className="overlay" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading the game…
        </div>
      ) : (
        <>
          <div className="hud-top" data-inset>
            <div className="turn-row">
              <TurnBar />
              {/* Phones only (CSS): My properties is on demand there */}
              {mine.length > 0 && (
                <button type="button" className="icon-button props-button" onClick={toggleProps} aria-pressed={ui.panel === 'props'} aria-label="My properties" title="My properties">
                  ⌂
                </button>
              )}
            </div>
            {session.online && !connected && (
              <p className="hud-banner danger" role="alert">
                <span className="spinner" aria-hidden="true" />Connection lost: reconnecting…
              </p>
            )}
            {tamper && <p className="hud-banner danger" role="alert">{tamper}</p>}
            <TableStatus />
            {mine.length === 0 && <p className="hud-banner" role="status">Watching: you have no seat in this game</p>}
            {mine.length === 0 && lateJoin && lateJoin.seats.length > 0 && <LateJoin {...lateJoin} />}
            {!glOk && <p className="hud-banner" role="status">3D view paused: playing on the 2D board</p>}
            <Toasts />
          </div>
          <aside className="hud-players" data-inset>
            <PlayersPanel />
          </aside>
          {(!glOk || mini) && (
            <div className="hud-board">
              <MiniBoard />
            </div>
          )}
          <aside className="hud-context" data-inset aria-label="Game">
            <DiceReadout />
            <div className="hud-decision" data-inset>
              {phase === 'auction' && !shown && <AuctionStatus />}
              {phone && decision}
              <TradeOffers onCounter={(from, draft) => openTrade(from, draft)} />
            </div>
            <MyProperties onClose={closePanel} />
            <EventLog expanded={ui.panel === 'log'} onToggle={toggleLog} />
          </aside>
          <div className="hud-dock" data-inset>
            <ActionBar
              seat={seat}
              onManage={() => openManage(seat)}
              onTrade={() => openTrade(seat)}
              onLog={toggleLog}
              onMenu={openMenu}
              {...(glOk ? { onRecenter: recenter, onMiniBoard: () => setMini((m) => !m) } : {})}
              miniBoard={!glOk || mini}
            />
          </div>
          <BoardCenter turnSeat={turnSeat}>{phone ? null : decision}</BoardCenter>
          <CardModal threeD={glOk && !mini} />
          {bidders.length > 0 && (
            <AuctionModal seats={bidders} covered={manageOpen || tradeOpen || inspecting || menuOpen} onRaise={openManage} />
          )}
          {over && (
            <GameOver onLeave={onLeave} {...(isOwner && onRematch ? { onRematch } : {})} covered={manageOpen || tradeOpen || inspecting || menuOpen} />
          )}
          {manageOpen && manageSeat && <ManageProperties key={manageSeat} seat={manageSeat} onClose={closePanel} covered={inspecting || menuOpen} />}
          {tradeOpen && trade && (
            <TradeBuilder key={trade.n} seat={trade.seat} {...(trade.draft ? { initial: trade.draft } : {})} onClose={closePanel} covered={inspecting || menuOpen} />
          )}
          <TileInspector covered={menuOpen} />
          {passing && <PassDevice seat={passing} onReady={() => setHand((h) => ({ ...h, pass: null }))} covered={menuOpen} />}
          {menuOpen && (
            <GameMenu
              onResume={closePanel}
              onLeave={onLeave}
              isOwner={isOwner}
              {...(ownerActions ? { ownerActions } : {})}
              {...(onTakeBack ? { onTakeBack } : {})}
            />
          )}
        </>
      )}
    </div>
  );
}

/** The Panel size setting as this window can take it (fitUiScale), following resizes */
function useFittedScale(uiScale: number): number {
  const size = () => (typeof window === 'undefined' ? { w: 1440, h: 900 } : { w: window.innerWidth, h: window.innerHeight });
  const [vp, setVp] = useState(size);
  useEffect(() => {
    const onResize = () => setVp((v) => {
      const n = size();
      return n.w === v.w && n.h === v.h ? v : n;
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return fitUiScale(uiScale, vp.w, vp.h);
}

/** Late join: a spectator picks a bot's (or an abandoned) seat to play from now on */
function LateJoin({ seats, take }: { seats: SeatId[]; take(seat: SeatId): void }) {
  const doc = useDoc();
  const [pick, setPick] = useState<SeatId | ''>('');
  const seat = pick && seats.includes(pick) ? pick : seats[0];
  if (!doc || !seat) return null;
  const name = (x: SeatId) => doc.seats[x]?.name ?? doc.game.players[x]?.name ?? x;
  return (
    <div className="hud-banner late-join" role="group" aria-label="Join the game">
      {seats.length > 1 ? (
        <label>
          <span className="sr-only">Seat to take</span>
          <select value={seat} onChange={(e) => setPick(e.target.value as SeatId)}>
            {seats.map((x) => <option key={x} value={x}>{name(x)}{doc.seats[x]?.kind === 'bot' ? ' (bot)' : ' (left)'}</option>)}
          </select>
        </label>
      ) : (
        <span>{name(seat)}'s seat is free to take over.</span>
      )}
      <button type="button" className="primary" onClick={() => take(seat)}>Take a seat</button>
    </div>
  );
}
