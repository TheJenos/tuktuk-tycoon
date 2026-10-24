import { netWorth } from '../../../rules';
import { safeColor } from '../../colors';
import { useDoc, useGame, useNames } from '../context';
import { Dialog } from '../Dialog';
import { money } from '../format';
import { TokenIcon } from '../tokenIcons';

const WHY = {
  lastStanding: 'Last player standing',
  turnLimit: 'Turn limit reached: ranked by net worth',
  endGame: 'Finished early: ranked by net worth',
} as const;

/** The winner and the standings, with the way back to the lobby and (for the room's owner) a rematch */
export function GameOver({ onLeave, onRematch, covered }: { onLeave(): void; onRematch?: () => void; covered: boolean }) {
  const s = useGame();
  const doc = useDoc();
  const names = useNames();
  if (!s || s.phase.k !== 'over') return null;
  const ph = s.phase;
  return (
    <Dialog
      id="game-over"
      className="game-over"
      title={`${names.seat(ph.winner)} wins!`}
      covered={covered}
      aside={<span className="muted">{WHY[ph.why]}</span>}
      footer={
        <>
          <button type="button" onClick={onLeave}>Back to lobby</button>
          {onRematch && (
            <button type="button" className="primary" onClick={onRematch} autoFocus>
              Rematch
            </button>
          )}
        </>
      }
    >
      <ol className="standings">
        {ph.ranking.map((seat, i) => {
          const p = s.players[seat];
          const info = doc?.seats[seat];
          return (
            <li key={seat} className={i === 0 ? 'winner' : undefined}>
              <span className="place">{i + 1}</span>
              <span style={{ color: safeColor(info?.color) }}>
                <TokenIcon token={info?.token ?? 'hat'} size={22} />
              </span>
              <strong>{names.seat(seat)}</strong>
              <span className="muted">
                {p?.out ? (p.out === 'resigned' ? 'resigned' : 'bankrupt') : `net worth ${money(netWorth(s, seat))}`}
              </span>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}
