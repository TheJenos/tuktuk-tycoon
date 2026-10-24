import { useState, type FormEvent } from 'react';
import { MenuFrame } from '../MenuShell';
import { NAME_PATTERN, saveName } from '../playerName';
import './lobby.css';

/** The first visit: pick the name everyone sees you by (kept in this browser; Settings changes it) */
export function NameForm({ invite, onDone }: { invite: string | null; onDone(name: string): void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = draft.trim().replace(/\s+/g, ' ');
    if (!NAME_PATTERN.test(name)) {
      setError('Names are 2–16 characters: letters, numbers, spaces, - or _.');
      return;
    }
    saveName(name);
    onDone(name);
  };
  return (
    <MenuFrame seeThrough>
      <div className="menu-welcome">
        <form className="name-setup" onSubmit={submit} data-testid="app-ready">
          <p className="kicker">Classic rules · Speed Die · no downloads</p>
          <h2>What should we call you?</h2>
          <p className="muted">
            {invite ? <>You've been invited to room <strong>{invite}</strong>. </> : null}
            It's how the other players see you at the table. You can change it later in Settings.
          </p>
          <div className="row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={16}
              placeholder="e.g. Rich Uncle"
              autoComplete="nickname"
              autoFocus
              aria-label="Your name"
              aria-invalid={error ? true : undefined}
            />
            <button type="submit" className="primary" disabled={draft.trim().length < 2}>Continue ▸</button>
          </div>
          <small className="muted">2–16 characters: letters, numbers, spaces, - or _.</small>
          <p className="error" role={error ? 'alert' : undefined}>{error}</p>
        </form>
      </div>
    </MenuFrame>
  );
}
