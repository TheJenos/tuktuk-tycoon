/** What the online views say in a build with no database (onlineAvailable() is false) */
export function OnlineNotice({ onLocal }: { onLocal?: () => void }) {
  return (
    <div className="lobby-notice" role="note">
      <strong>Online play needs a Firebase project — see README</strong>
      <p className="muted">
        This build has no database to meet other players in. Copy <code>.env.example</code> to <code>.env</code> and
        fill in your Firebase web app's config, or run the local emulator (<code>npm run emulator</code>, then{' '}
        <code>npm run dev:emu</code>). Play now and Local game work without it.
      </p>
      {onLocal && <button type="button" onClick={onLocal}>Set up a local game</button>}
    </div>
  );
}
