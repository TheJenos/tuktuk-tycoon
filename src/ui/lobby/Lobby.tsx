import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { onlineAvailable, onlineDb } from '../../net/db';
import { playerId } from '../../net/ids';
import { createLocalSession, hasSoloSave } from '../../net/local';
import type { LobbyRecord } from '../../net/network';
import { forgetRoom, savedSeats } from '../../net/rejoin';
import { OFFLINE_TIMERS } from '../../shared/timing';
import { clearInvite, enterLocal, takeLaunch } from '../../state/app';
import { errorMessage } from '../errors';
import { MenuFrame, MenuPanel, MenuPlay, MenuRail, ProfileChip, type MenuTab } from '../MenuShell';
import { createRoom, isClosedError, joinErrorText, joinRoom } from './connect';
import { CreateWizard, type RoomPlan } from './CreateWizard';
import { LocalWizard } from './LocalWizard';
import { OnlineNotice } from './OnlineNotice';
import { CodeJoin, RoomList, RoomSearch, useRooms } from './RoomBrowser';
import { draftOptions, draftRules, roomTimers, type RulesDraft } from './RulesForm';
import { SettingsView } from './SettingsView';
import { startingSeats, toLocalSeats, type SeatDraft } from './seats';
import './lobby.css';

/*
 * The main menu over the slowly turning board: Play now vs bots (and Continue when a solo game is saved) as the big
 * actions, then the views: a local game (hot-seat and bots), the online rooms, opening a room, and Settings. Joining
 * by code sits under the views. An invite link counts down two seconds then goes straight in; a reload while in a
 * room goes straight back.
 */

type Tab = 'local' | 'rooms' | 'create' | 'settings';
/** What's under way, and where its error belongs */
type Action = 'play' | 'local' | 'code' | 'list' | 'create' | 'invite' | 'rejoin';

/** The view last open, for this visit (coming back from a game opens it again) */
let lastTab: Tab = 'local';

const INVITE_DELAY_MS = 2_000;

interface Invite {
  code: string;
  phase: 'auto' | 'closed' | 'offline';
}

interface Running {
  code: string;
  status: LobbyRecord['status'];
}

/** Rooms this browser holds a seat in that are still open (looked up once, only when there are some) */
function useStillRunning(online: boolean, skip: string | null): Running[] {
  const [running, setRunning] = useState<Running[]>([]);
  useEffect(() => {
    const saved = savedSeats().filter((s) => s.code !== skip).slice(0, 3);
    if (!online || !saved.length) return;
    let cancelled = false;
    void onlineDb().then(async (db) => {
      const recs = await Promise.all(saved.map(async (s) => ({ code: s.code, rec: await db.get<LobbyRecord>(`lobby/${s.code}`).catch(() => null) })));
      if (cancelled) return;
      setRunning(recs.flatMap((r) => (r.rec && typeof r.rec.name === 'string' && r.rec.status !== 'finished' ? [{ code: r.code, status: r.rec.status }] : [])));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [online, skip]);
  return running;
}

export function Lobby({ name, onRename, notice }: { name: string; onRename(name: string): void; notice: string | null }) {
  const online = onlineAvailable();
  const [launch] = useState(takeLaunch);
  const rejoinNow = launch.rejoin && online && (!launch.invite || launch.invite === launch.rejoin.code) ? launch.rejoin : null;
  const [tab, setTabState] = useState<Tab>(lastTab);
  const [roomsSeen, setRoomsSeen] = useState(lastTab === 'rooms');
  const setTab = useCallback((t: Tab) => {
    lastTab = t;
    setTabState(t);
    if (t === 'rooms') setRoomsSeen(true);
  }, []);
  const [busy, setBusyState] = useState<Action | null>(null);
  // Read by callbacks made in an earlier render (the invite's countdown), so one join never races another
  const busyRef = useRef<Action | null>(null);
  const setBusy = (a: Action | null) => {
    busyRef.current = a;
    setBusyState(a);
  };
  const [joiningCode, setJoiningCode] = useState('');
  const [error, setError] = useState<{ at: Action; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState(hasSoloSave);
  const [invite, setInvite] = useState<Invite | null>(() =>
    !launch.invite || rejoinNow ? null : { code: launch.invite, phase: online ? 'auto' : 'offline' });
  const [counting, setCounting] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const running = useStillRunning(online, rejoinNow?.code ?? null).filter((r) => !dismissed.includes(r.code));
  const { rooms, failed, retry } = useRooms(online && roomsSeen);
  const errorAt = (at: Action) => (error?.at === at ? error.text : '');

  /** Something local (sync): a thrown error stays by its button */
  const run = (at: Action, fn: () => void) => {
    if (busyRef.current) return;
    setError(null);
    try {
      fn();
    } catch (err) {
      console.error(err);
      setError({ at, text: errorMessage(err) });
      setSaved(hasSoloSave());
    }
  };

  /** Into an online room; this screen goes away when it works */
  const go = async (at: Action, code: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    setBusy(at);
    setJoiningCode(code);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (isClosedError(err)) {
        // Gone for good: a reload or the banner shouldn't try it again
        forgetRoom(code, { seat: true });
        clearInvite();
        setDismissed((d) => [...d, code]);
      }
      if (at === 'invite' && isClosedError(err)) {
        setInvite({ code, phase: 'closed' });
      } else {
        const text = joinErrorText(err);
        if (text) setError({ at, text });
        if (at === 'invite') setInvite(null);
      }
      setBusy(null);
      setJoiningCode('');
    }
  };

  const join = (raw: string, at: Action, pid?: string) => {
    const code = raw.trim().toUpperCase();
    return go(at, code, () => joinRoom(code, name, pid ? { pid, label: `Rejoining room ${code}…` } : {}));
  };

  // A reload while in a room: straight back in, as the same player
  useEffect(() => {
    if (rejoinNow) void join(rejoinNow.code, 'rejoin', rejoinNow.pid);
    // Once, on the first look
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An invite: once the page has settled, two seconds to stay in the lobby, then straight in
  useEffect(() => {
    if (invite?.phase !== 'auto') return;
    let timer = 0;
    const begin = () => {
      setCounting(true);
      timer = window.setTimeout(() => void join(invite.code, 'invite'), INVITE_DELAY_MS);
    };
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(begin, { timeout: 1000 }) : (begin(), 0);
    return () => {
      clearTimeout(timer);
      if (idle) cancelIdleCallback(idle);
      setCounting(false);
    };
    // The invite alone decides
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite]);

  const playNow = () => run('play', () => {
    const session = createLocalSession({ name, seats: toLocalSeats(startingSeats(name, { bots: 3 })), timers: OFFLINE_TIMERS });
    enterLocal(session);
  });

  const resume = () => run('play', () => {
    if (!hasSoloSave()) {
      setSaved(false);
      throw new Error('The saved game is gone.');
    }
    enterLocal(createLocalSession({ name, seats: [], resume: true }));
  });

  const startLocal = (rules: RulesDraft, seats: SeatDraft[]) => run('local', () => {
    enterLocal(createLocalSession({
      name,
      seats: toLocalSeats(seats),
      rules: draftRules(rules),
      timers: roomTimers(rules, false),
      pace: rules.botPace,
      botSkill: rules.botSkill,
      timeLimit: rules.timeLimit,
    }));
  });

  const create = (plan: RoomPlan) => go('create', '', () => createRoom({
    me: playerId(),
    host: name,
    name: plan.name.trim() || `${name}'s room`,
    rules: draftRules(plan.rules),
    timers: roomTimers(plan.rules),
    options: draftOptions(plan.rules),
    maxSeats: plan.maxSeats,
    public: plan.public,
    bots: plan.bots.map((skill) => ({ skill })),
    token: plan.token,
  }));

  const stayHere = () => {
    setInvite(null);
    clearInvite();
  };

  const tabs: MenuTab[] = [
    { id: 'local', label: 'Local game', short: 'Local', sub: 'Friends at this screen, and bots', icon: '♟' },
    {
      id: 'rooms', label: 'Rooms', short: 'Rooms', sub: online ? 'Join a game online' : 'Needs a Firebase project', icon: '◇',
      ...(rooms ? { count: rooms.length, countLabel: `${rooms.length} open` } : {}),
    },
    { id: 'create', label: 'Create room', short: 'Create', sub: 'Invite friends online', icon: '＋' },
    { id: 'settings', label: 'Settings', short: 'Settings', sub: 'Your name, graphics, sound', icon: '⚙' },
  ];

  const alerts: ReactNode[] = [];
  if (notice) alerts.push(<div key="notice" className="warning" role="alert">{notice}</div>);
  if (errorAt('rejoin')) alerts.push(<div key="rejoin" className="warning" role="alert">{errorAt('rejoin')}</div>);
  if (invite?.phase === 'auto') {
    alerts.push(
      <div key="invite" className="invite-card" role="status">
        <p>
          {busy === 'invite' && <span className="spinner" aria-hidden="true" />}
          Joining room <strong>{invite.code}</strong>…
        </p>
        <div className="row">
          <button type="button" className="primary" disabled={!!busy} onClick={() => void join(invite.code, 'invite')}>Join now</button>
          <button type="button" disabled={!!busy} onClick={stayHere}>Stay in the lobby</button>
        </div>
        {busy !== 'invite' && counting && <div className="progress" aria-hidden="true" />}
      </div>,
    );
  } else if (invite?.phase === 'closed') {
    alerts.push(<div key="closed" className="warning" role="alert">That room has closed. Open a new one, or ask for a fresh invite.</div>);
  } else if (invite?.phase === 'offline') {
    alerts.push(<div key="offline" className="warning" role="alert">You were invited to room <strong>{invite.code}</strong>, but online play needs a Firebase project — see README.</div>);
  }
  if (errorAt('invite')) alerts.push(<div key="invite-error" className="warning" role="alert">{errorAt('invite')}</div>);
  for (const r of running) {
    alerts.push(
      <div key={`run-${r.code}`} className="rejoin-card" role="status">
        <p>{r.status === 'playing' ? <>Your game in <strong>{r.code}</strong> is still running</> : <>Your room <strong>{r.code}</strong> is still open</>} — </p>
        <button type="button" className="primary" disabled={!!busy} onClick={() => void join(r.code, 'rejoin')}>Rejoin</button>
        <button type="button" className="icon-button" aria-label={`Not now (${r.code})`} title="Not now" onClick={() => setDismissed([...dismissed, r.code])}>✕</button>
      </div>,
    );
  }

  return (
    <MenuFrame seeThrough profile={<ProfileChip name={name} title="Your name on this browser (change it in Settings)" />}>
      <div className="menu-alerts">{alerts}</div>
      <MenuRail
        hero={(
          <div className="menu-play-wrap" data-testid="app-ready">
            <MenuPlay
              label={<><span aria-hidden="true">▶</span> Play now</>}
              sub={saved ? 'vs bots: a new game (it replaces your saved one)' : 'vs bots: you and 3 Normal bots, Classic rules'}
              disabled={!!busy}
              onClick={playNow}
            />
            {saved && <MenuPlay secondary label="Continue solo game" sub="Pick up where you left off" disabled={!!busy} onClick={resume} />}
            {errorAt('play') && <p className="error" role="alert">{errorAt('play')}</p>}
          </div>
        )}
        tabs={tabs}
        active={tab}
        onSelect={(id) => setTab(id as Tab)}
        extra={online ? (
          <CodeJoin
            key={invite?.phase === 'closed' ? 'closed' : 'open'}
            initialCode={invite && invite.phase !== 'closed' ? invite.code : ''}
            busy={busy === 'code'}
            disabled={!!busy}
            error={errorAt('code')}
            onJoin={(c) => void join(c, 'code')}
          />
        ) : undefined}
      />

      {tab === 'local' && (
        <MenuPanel id="local" title="Local game">
          <LocalWizard you={name} busy={busy === 'local'} error={errorAt('local')} onStart={startLocal} />
        </MenuPanel>
      )}

      {tab === 'rooms' && (
        <MenuPanel
          id="rooms"
          title={<>Open rooms {rooms && <span className="live"><span className="dot" aria-hidden="true" />{rooms.length} live</span>}</>}
          aside={online ? <RoomSearch value={search} onChange={setSearch} /> : undefined}
        >
          {!online ? <OnlineNotice onLocal={() => setTab('local')} /> : (
            <>
              {errorAt('list') && <p className="error" role="alert">{errorAt('list')}</p>}
              <RoomList
                rooms={rooms}
                failed={failed}
                retry={retry}
                search={search}
                onClearSearch={() => setSearch('')}
                joining={busy === 'list' ? joiningCode : ''}
                disabled={!!busy}
                onJoin={(c) => void join(c, 'list')}
                onCreate={() => setTab('create')}
              />
            </>
          )}
        </MenuPanel>
      )}

      {tab === 'create' && (
        <MenuPanel id="create" title="Create a room">
          {!online ? <OnlineNotice onLocal={() => setTab('local')} /> : (
            <CreateWizard you={name} busy={busy === 'create'} error={errorAt('create')} onCreate={(p) => void create(p)} />
          )}
        </MenuPanel>
      )}

      {tab === 'settings' && (
        <MenuPanel id="settings" title="Settings" aside={<span className="muted">Saved as you go</span>}>
          <SettingsView name={name} onRename={onRename} />
        </MenuPanel>
      )}
    </MenuFrame>
  );
}
