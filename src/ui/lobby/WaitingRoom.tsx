import { useEffect, useRef, useState } from 'react';
import { RoomError, setupSeats } from '../../net/network';
import type { BotSkill, SeatInfo } from '../../net/types';
import type { SeatId } from '../../rules';
import type { TokenId } from '../../shared/tokens';
import { leaveRoom, type Room } from '../../state/app';
import { useStore } from '../../state/store';
import { Brand } from '../Brand';
import { ConfirmButton } from '../ConfirmButton';
import { friendlyError } from '../errors';
import { MenuPanel, MenuPlay, MenuRail, type MenuTab } from '../MenuShell';
import { DEFAULT_DRAFT, roomDraft, roomPatch, RulesForm, RulesSummary } from './RulesForm';
import { SettingsView } from './SettingsView';
import { SeatToken, TokenPicker } from './TokenPicker';
import { SKILLS, skillLabel } from './seats';
import './lobby.css';

/*
 * An online room before its game: who sits where (with an online dot for each player), your token, the rules, and
 * the way to bring friends in. The owner adds, changes and removes bots, removes players, edits the rules and starts
 * once at least two seats are filled; everyone else waits for them. The game screen takes over when it starts.
 */

type Tab = 'players' | 'rules' | 'settings';

const MIN_START = 2;
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const errorText = (err: unknown): string => (err instanceof RoomError ? err.message : friendlyError(err));

export function WaitingRoom({ room, name }: { room: Room; name: string }) {
  const v = useStore(room.view);
  const conn = room.conn;
  const [tab, setTab] = useState<Tab>('players');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ n: number; text: string } | null>(null);
  const [newBot, setNewBot] = useState<BotSkill>('normal');
  const [editing, setEditing] = useState<SeatId | null>(null);
  const toastTimer = useRef(0);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const lobby = v.lobby;
  const seats = v.setup ? setupSeats(v.setup) : [];
  const me = conn.me;
  const mine = seats.find((s) => s.kind === 'human' && s.ctrl === me) ?? null;
  const owner = v.owner?.id === me;
  const ownerName = v.owner?.name || lobby?.host || 'the host';
  const max = lobby?.maxSeats ?? 8;
  const here = (pid: string) => !!pid && (!!v.presence[pid] || lobby?.members?.[pid] !== undefined);
  const watchers = Object.entries(v.presence).filter(([pid, p]) => !p.seat && !seats.some((s) => s.ctrl === pid)).map(([, p]) => p.name);
  const rules = v.setup ? roomDraft(v.setup.rules) : DEFAULT_DRAFT;
  const canStart = seats.length >= MIN_START;
  // Inside Discord the App has no name of its own: the one this room knows us by
  const myName = v.presence[me]?.name || mine?.name || name;

  const say = (text: string) => {
    clearTimeout(toastTimer.current);
    setToast((t) => ({ n: (t?.n ?? 0) + 1, text }));
    toastTimer.current = window.setTimeout(() => setToast(null), 4_000);
  };

  /** One owner or seat change at a time; a refusal shows above the rail */
  const act = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    const url = conn.inviteUrl();
    if (COARSE && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Tuk-Tuk Tycoon', text: `Join my Tuk-Tuk Tycoon game: room ${conn.code}`, url });
        return;
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      say('Invite link copied: send it to your friends.');
    } catch {
      say(`Invite link: ${url}`);
    }
  };

  const tabs: MenuTab[] = [
    { id: 'players', label: 'Players', short: 'Players', sub: `${seats.length} of ${max} seats`, icon: '◈' },
    { id: 'rules', label: 'Rules', short: 'Rules', sub: rules.speedDie ? 'Classic + Speed Die' : 'Classic', icon: '▤' },
    { id: 'settings', label: 'Settings', short: 'Settings', sub: 'Graphics, motion, sound', icon: '⚙' },
  ];

  const taken = (seat: SeatInfo) => seats.filter((x) => x.seat !== seat.seat).map((x) => x.token);

  return (
    <section id="waiting-room" className={room.discord ? 'screen menu see-through discord' : 'screen menu see-through'} aria-label="Waiting room">
      <div className="menu-backdrop" aria-hidden="true">
        <div className="menu-backdrop-shade" />
      </div>
      <header className="menu-top">
        <Brand />
        <div className="room-chip" title={lobby?.public === false ? 'Private room: only people with the code can join' : 'Listed in Rooms'}>
          <span className="room-chip-name">{lobby?.name ?? 'Room'}</span>
          <span className="muted">Code</span>
          <strong className="room-code">{conn.code}</strong>
        </div>
      </header>
      <div className="menu-body">
        <div className="menu-alerts">
          {!v.connected && (
            <div className="warning" role="alert"><span className="spinner" aria-hidden="true" />Connection lost: reconnecting…</div>
          )}
          {error && <div className="warning" role="alert">{error}</div>}
        </div>
        <MenuRail
          label="Waiting room"
          tabsLabel="Waiting room"
          idPrefix="wait-"
          hero={owner ? (
            <div className="menu-play-wrap">
              <MenuPlay
                label="Start game"
                sub={canStart ? `${seats.length} at the table` : 'Add a bot, or wait for someone to join'}
                disabled={!canStart || (!!busy && busy !== 'start')}
                busy={busy === 'start'}
                onClick={() => void act('start', () => conn.start())}
              />
            </div>
          ) : (
            <div className="waiting-status" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>Waiting for <strong>{ownerName}</strong> to start</span>
            </div>
          )}
          tabs={tabs}
          active={tab}
          onSelect={(id) => setTab(id as Tab)}
          extra={(
            <div className="waiting-extra">
              {room.discord ? (
                <p className="code-join-box muted">Everyone in this voice channel can join from the Activity.</p>
              ) : (
                <div className="code-join-box invite-box">
                  <span className="code-join-title">Bring friends</span>
                  <p className="muted">Send them the link, or the code <strong className="room-code">{conn.code}</strong>.</p>
                  <button type="button" className="primary" onClick={() => void invite()}>Copy invite</button>
                </div>
              )}
              <ConfirmButton className="danger menu-leave" question="Leave the room?" yes="Leave" no="Stay" onConfirm={() => leaveRoom(room)}>
                <span className="icon" aria-hidden="true">↩</span>Leave room
              </ConfirmButton>
            </div>
          )}
        />

        {tab === 'players' && (
          <MenuPanel
            id="players"
            idPrefix="wait-"
            title={<>Players <span className="count muted">{seats.length}/{max}</span></>}
            aside={owner ? (
              <div className="add-bot">
                <label>
                  <span className="sr-only">Level of the next bot</span>
                  <select value={newBot} onChange={(e) => setNewBot(e.target.value as BotSkill)}>
                    {SKILLS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </label>
                <button type="button" disabled={seats.length >= max || !!busy} onClick={() => void act('bot', () => conn.addBot(newBot))}>
                  ＋ Add bot
                </button>
              </div>
            ) : undefined}
          >
            <ul className="seat-cards">
              {seats.map((s) => {
                const online = s.kind === 'human' && here(s.ctrl);
                return (
                  <li key={s.seat} className={`seat-card ${s.kind}${s.ctrl === me && s.kind === 'human' ? ' mine' : ''}`}>
                    <div className="seat-card-main">
                      <SeatToken token={s.token} color={s.color} size={30} named />
                      <span className="seat-who">
                        <strong>{s.name}</strong>
                        <span className="seat-badges">
                          {s.kind === 'human' && s.ctrl === me && <span className="badge accent">You</span>}
                          {s.kind === 'human' && s.ctrl === v.owner?.id && <span className="badge">Host</span>}
                          {s.kind === 'bot' && <span className="badge bot">Bot · {skillLabel(s.skill)}</span>}
                        </span>
                      </span>
                      {s.kind === 'human' && (
                        <span className={online ? 'online-dot on' : 'online-dot'} role="img" aria-label={online ? 'Online' : 'Offline'} title={online ? 'Online' : 'Offline'} />
                      )}
                    </div>
                    {owner && s.ctrl !== me && (s.kind === 'bot' || !!s.ctrl) && (
                      <div className="seat-card-actions">
                        {s.kind === 'bot' && (
                          <span className="seat-controls">
                            <label>
                              <span className="sr-only">{s.name}'s level</span>
                              <select value={s.skill ?? 'normal'} disabled={!!busy} onChange={(e) => void act('edit', () => conn.editBot(s.seat, e.target.value as BotSkill))}>
                                {SKILLS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                              </select>
                            </label>
                            <button type="button" className="icon-button" aria-expanded={editing === s.seat} aria-label={`Change ${s.name}'s token`} title="Token" onClick={() => setEditing(editing === s.seat ? null : s.seat)}>
                              ◐
                            </button>
                            <button type="button" className="icon-button" aria-label={`Remove ${s.name}`} title="Remove" disabled={!!busy} onClick={() => void act('remove', () => conn.removeBot(s.seat))}>
                              ✕
                            </button>
                          </span>
                        )}
                        {s.kind === 'human' && (
                          <ConfirmButton className="danger" question={`Remove ${s.name}?`} yes="Kick" no="Keep" onConfirm={() => void act('kick', () => conn.kick(s.ctrl))}>
                            Kick
                          </ConfirmButton>
                        )}
                      </div>
                    )}
                    {owner && s.kind === 'bot' && editing === s.seat && (
                      <TokenPicker label={`${s.name}'s token`} value={s.token} color={s.color} taken={taken(s)} disabled={!!busy} onPick={(t: TokenId) => void act('token', () => conn.setSeatToken(t, s.seat))} />
                    )}
                  </li>
                );
              })}
              {Array.from({ length: Math.max(0, max - seats.length) }, (_, i) => (
                <li key={`open-${i}`} className="seat-card open">
                  <div className="seat-card-main">
                    <span className="seat-token empty" aria-hidden="true" />
                    <span className="muted">Open seat</span>
                  </div>
                </li>
              ))}
            </ul>
            {mine ? (
              <div className="my-token">
                <h3>Your token</h3>
                <TokenPicker label="Your token" value={mine.token} color={mine.color} taken={taken(mine)} disabled={!!busy} onPick={(t) => void act('token', () => conn.setSeatToken(t))} />
              </div>
            ) : (
              <div className="spectating" role="status">
                <span>You're watching this room.</span>
                {seats.length < max ? (
                  <button type="button" className="primary" disabled={!!busy} onClick={() => void act('seat', () => conn.claimSeat())}>Take a seat</button>
                ) : (
                  <span className="muted">Every seat is taken.</span>
                )}
              </div>
            )}
            {mine && !owner && (
              <button type="button" className="link-button" disabled={!!busy} onClick={() => void act('seat', () => conn.leaveSeat())}>Give up my seat and watch</button>
            )}
            {watchers.length > 0 && <p className="muted watchers">Watching: {watchers.join(', ')}</p>}
          </MenuPanel>
        )}

        {tab === 'rules' && (
          <MenuPanel id="rules" idPrefix="wait-" title="Rules" aside={<span className="muted">{owner ? 'Changes apply at once' : `Set by ${ownerName}`}</span>}>
            {owner ? (
              <RulesForm online value={rules} onChange={(p) => void conn.setRules(roomPatch(p)).catch((err: unknown) => setError(errorText(err)))} />
            ) : (
              <RulesSummary value={rules} online />
            )}
          </MenuPanel>
        )}

        {tab === 'settings' && (
          <MenuPanel id="settings" idPrefix="wait-" title="Settings" aside={<span className="muted">Playing as {myName}</span>}>
            <SettingsView name={myName} />
          </MenuPanel>
        )}
      </div>
      {toast && <p key={toast.n} className="lobby-toast" role="status">{toast.text}</p>}
    </section>
  );
}
