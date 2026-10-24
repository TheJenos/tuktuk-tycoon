/** The game's mark next to its wordmark (lobbies). The title's last word takes the accent colour. */
export function Brand({ title = 'TUK-TUK TYCOON' }: { title?: string }) {
  const cut = title.lastIndexOf(' ');
  return (
    <div className="brand">
      <img src="/brand/logo.svg" alt="" width={56} height={56} />
      {/* The space stays in the text, so the name reads as two words */}
      <h1>{cut > 0 ? <>{title.slice(0, cut)} <span>{title.slice(cut + 1)}</span></> : title}</h1>
    </div>
  );
}
