import { useState } from 'react';
import { IN_DISCORD } from '../discord/patch';
import { Stage } from '../scene/Stage';
import { appStore, launchIntent, type Joining } from '../state/app';
import { useStore } from '../state/store';
import { DiscordLobby } from './lobby/DiscordLobby';
import { LocalGame, RoomScreen } from './lobby/GameScreens';
import { Lobby } from './lobby/Lobby';
import { NameForm } from './lobby/NameForm';
import { isValidName, loadName, saveName } from './playerName';

/*
 * The whole app: one persistent 3D stage behind everything (the lobby's turning board, then the game's), and the
 * screen over it: the name form on a first visit, the lobby, a local game, or an online room (its waiting room, then
 * its game). Inside a Discord Activity the Discord lobby stands in for the lobby. There is no router: src/state/app.ts
 * says which screen is up.
 */

export function App() {
  const { screen, joining } = useStore(appStore);
  const [name, setName] = useState(() => {
    const saved = loadName().trim();
    return isValidName(saved) ? saved : '';
  });
  const rename = (next: string) => {
    saveName(next);
    setName(next);
  };

  let content;
  if (screen.k === 'local') content = <LocalGame session={screen.session} name={name} />;
  else if (screen.k === 'room') content = <RoomScreen room={screen.room} name={name} />;
  else if (IN_DISCORD) content = <DiscordLobby notice={screen.notice} />;
  else if (!name) content = <NameForm invite={launchIntent().invite} onDone={setName} />;
  else content = <Lobby name={name} onRename={rename} notice={screen.notice} />;

  return (
    <>
      <Stage />
      {content}
      {joining && <ConnectingOverlay joining={joining} />}
    </>
  );
}

/** Over everything while a room is being joined or opened, with a way back */
function ConnectingOverlay({ joining }: { joining: Joining }) {
  return (
    <div id="connecting-overlay" className="overlay" role="status" aria-live="polite">
      <img className="loading-logo" src="/brand/logo.svg" alt="" width={72} height={72} />
      <h2><span className="spinner" aria-hidden="true" />{joining.label}</h2>
      <button type="button" onClick={joining.cancel}>Cancel</button>
    </div>
  );
}
