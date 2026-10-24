import { useEffect, useState } from 'react';
import { connectDiscord, type DiscordSession } from '../../discord/discord';
import { onlineAvailable, onlineDb } from '../../net/db';
import { discordPlayerId, discordRoomCode } from '../../net/ids';
import { roomInUse, type LobbyRecord } from '../../net/network';
import { friendlyError } from '../errors';
import { MenuFrame, MenuPanel, MenuPlay, MenuRail, ProfileChip, type MenuTab } from '../MenuShell';
import { joinErrorText, joinOrCreateRoom } from './connect';
import { LaunchStep, newRoomPlan, TableStep, type RoomPlan } from './CreateWizard';
import { OnlineNotice } from './OnlineNotice';
import { draftOptions, draftRules, roomTimers, RulesForm } from './RulesForm';
import { SettingsView } from './SettingsView';
import { Wizard } from './Wizard';
import './lobby.css';

/*
 * The start screen inside a Discord Activity: the player is signed in with Discord, and the voice channel is the
 * room (its code comes from the Activity's instance id). The first one in picks the rules and opens the table;
 * everyone after joins it, taking a free seat or watching. Rejoining works across devices: the player id is the
 * Discord user's.
 */

type Tab = 'table' | 'settings';

interface Signed {
  user: DiscordSession;
  code: string;
}

export function DiscordLobby({ notice }: { notice: string | null }) {
  const online = onlineAvailable();
  const [signed, setSigned] = useState<Signed | null>(null);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  /** The channel's room while somebody is in it or its game runs (undefined: still looking) */
  const [existing, setExisting] = useState<LobbyRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('table');
  const [plan, setPlan] = useState<RoomPlan>(newRoomPlan);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void (async () => {
      const user = await connectDiscord();
      const code = await discordRoomCode(user.instanceId);
      if (!cancelled) setSigned({ user, code });
    })().catch((err: unknown) => {
      if (!cancelled) setFailure(friendlyError(err));
    });
    return () => {
      cancelled = true;
    };
  }, [online, attempt]);

  // Live: someone else may open the table while this player is still choosing
  useEffect(() => {
    if (!signed) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    onlineDb().then((db) => {
      if (cancelled) return;
      stop = db.watch<LobbyRecord>(`lobby/${signed.code}`, (rec) => {
        // A running game counts even when everyone has closed the Activity: they come back to their seats
        setExisting(rec && typeof rec.name === 'string' && roomInUse(rec, Date.now()) ? rec : null);
      }, (err) => setError(friendlyError(err)));
    }, (err: unknown) => setError(friendlyError(err)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [signed]);

  const enter = async (open: boolean) => {
    if (!signed || busy) return;
    setBusy(true);
    setError('');
    try {
      await joinOrCreateRoom(signed.code, {
        me: discordPlayerId(signed.user.userId),
        host: signed.user.name,
        name: 'Discord game',
        public: false,
        ...(open ? {
          rules: draftRules(plan.rules),
          timers: roomTimers(plan.rules),
          options: draftOptions(plan.rules),
          maxSeats: plan.maxSeats,
          bots: plan.bots.map((skill) => ({ skill })),
          token: plan.token,
        } : {}),
      });
    } catch (err) {
      setError(joinErrorText(err) ?? '');
      setBusy(false);
    }
  };

  if (!online || !signed) {
    return (
      <MenuFrame discord seeThrough>
        <div className="menu-welcome">
          <div className="name-setup discord-connect" role="status" data-testid="app-ready">
            {!online ? <OnlineNotice /> : (
              <>
                <h2>{failure ? 'Could not connect to Discord' : <><span className="spinner" aria-hidden="true" />Connecting to Discord…</>}</h2>
                {failure && (
                  <>
                    <p className="error">{failure}</p>
                    <button type="button" className="primary" onClick={() => (setFailure(''), setAttempt((a) => a + 1))}>Retry</button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </MenuFrame>
    );
  }

  const tabs: MenuTab[] = [
    { id: 'table', label: 'This channel', short: 'Channel', sub: existing ? 'A table is open' : 'Open the voice channel’s table', icon: '◉' },
    { id: 'settings', label: 'Settings', short: 'Settings', sub: 'Graphics, motion, sound', icon: '⚙' },
  ];
  const seats = existing ? `${existing.seatsTaken}/${existing.maxSeats} seats` : '';

  return (
    <MenuFrame discord seeThrough profile={<ProfileChip name={signed.user.name} title="Your Discord name" />}>
      <div className="menu-alerts">
        {notice && <div className="warning" role="alert">{notice}</div>}
      </div>
      <MenuRail
        hero={(
          <div className="menu-play-wrap" data-testid="app-ready">
            <MenuPlay
              label={existing ? 'Join the game' : 'Open the table'}
              sub={existing ? `${existing.host}'s table · ${seats} · ${existing.status === 'waiting' ? 'waiting to start' : 'playing'}` : 'Everyone in this voice channel plays together'}
              busy={busy}
              disabled={existing === undefined}
              onClick={() => (existing ? void enter(false) : setTab('table'))}
            />
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        )}
        tabs={tabs}
        active={tab}
        onSelect={(id) => setTab(id as Tab)}
      />
      {tab === 'table' && (
        <MenuPanel id="table" title={existing ? 'This channel’s table' : 'Open this channel’s table'}>
          {existing === undefined ? (
            <p className="muted"><span className="spinner" aria-hidden="true" />Looking for this channel’s table…</p>
          ) : existing ? (
            <div className="channel-match">
              <div className="match-info">
                <div>
                  {existing.speedDie && <span className="badge speed">Speed Die</span>} <strong>{existing.host}</strong> opened the table · {seats}
                  <p className="muted">{existing.status === 'waiting' ? 'Waiting to start: join to take a seat.' : 'The game is on: join to take your seat back, or to watch.'}</p>
                </div>
              </div>
              <button type="button" className="primary create-button" disabled={busy} onClick={() => void enter(false)}>
                {busy ? <><span className="spinner" aria-hidden="true" />Joining…</> : 'Join the game'}
              </button>
            </div>
          ) : (
            <Wizard
              steps={[{ id: 'rules', label: 'Rules' }, { id: 'seats', label: 'Seats' }, { id: 'open', label: 'Open' }]}
              launchLabel="Open the table"
              busyLabel="Opening…"
              busy={busy}
              error={error}
              note="Everyone in this voice channel joins the same table."
              onLaunch={() => void enter(true)}
              render={(i, go) => {
                if (i === 0) return <RulesForm online value={plan.rules} onChange={(p) => setPlan({ ...plan, rules: { ...plan.rules, ...p } })} />;
                if (i === 1) return <TableStep plan={plan} onChange={(p) => setPlan({ ...plan, ...p })} />;
                return <LaunchStep plan={plan} go={go} />;
              }}
            />
          )}
        </MenuPanel>
      )}
      {tab === 'settings' && (
        <MenuPanel id="settings" title="Settings">
          <SettingsView name={signed.user.name} />
        </MenuPanel>
      )}
    </MenuFrame>
  );
}
