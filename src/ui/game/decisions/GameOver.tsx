import { netWorth, score, type GameState, type OverPhase, type SeatId } from '../../../rules';
import { safeColor } from '../../colors';
import { useDoc, useGame, useNames } from '../context';
import { Dialog } from '../Dialog';
import { plural, tokenOf, type Names } from '../format';
import { TokenIcon } from '../tokenIcons';

/** Why the game ended, ranked by net worth (or by Hero League's score) when it ended early */
function whyText(names: Names, why: OverPhase['why']): string {
  const ranked = `ranked by ${names.terms.worth}`;
  switch (why) {
    case 'lastStanding': return 'Last player standing';
    case 'turnLimit': return `Turn limit reached: ${ranked}`;
    case 'endGame': return `Finished early: ${ranked}`;
    case 'firstBankrupt': return `First bankruptcy: ${ranked}`;
    case 'timeUp': return `Time is up: ${ranked}`;
    case 'allSaved': return `Every ${names.terms.property} ${names.terms.bought}`;
  }
}

/** A standing's figure: net worth, or on Hero League the score and what makes it up ("score 2,140: 1,140 Power + 10 locations") */
function standingText(s: GameState, ph: OverPhase, names: Names, seat: SeatId): string {
  const p = s.players[seat];
  if (p?.out) return p.out === 'resigned' ? 'resigned' : 'bankrupt';
  if (!names.board.heroes) return `net worth ${names.money(netWorth(s, seat))}`;
  const points = ph.scores?.[seat] ?? score(s, seat);
  const held = Object.values(s.props).filter((ps) => ps?.owner === seat).length;
  return `${names.terms.worth} ${points.toLocaleString('en-US')}: ${names.money(p?.cash ?? 0)} + ${plural(held, names.terms.property)}`;
}

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
      aside={<span className="muted">{whyText(names, ph.why)}</span>}
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
          const info = doc?.seats[seat];
          return (
            <li key={seat} className={i === 0 ? 'winner' : undefined}>
              <span className="place">{i + 1}</span>
              <span style={{ color: safeColor(info?.color) }}>
                <TokenIcon token={tokenOf(s, seat, info?.token)} color={info?.color} size={22} />
              </span>
              <strong>{names.seat(seat)}</strong>
              <span className="muted">{standingText(s, ph, names, seat)}</span>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}
