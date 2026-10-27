import type { BoardDef, GameState } from '../../../rules';
import { safeColor } from '../../colors';
import { capital, money, termsOf } from '../format';
import { deedFor } from './deed';
import '../heroes.css';

/**
 * A Title Deed card: colour band, price, the rent table (the row that applies now highlighted), building costs and
 * the mortgage values. `compact` drops the costs (the Buy prompt shows them on demand). A Hero League location's card
 * names its villain and has only the power-up rows.
 */
export function TitleDeed({ board, space, s, compact = false }: { board: BoardDef; space: number; s: GameState | null; compact?: boolean }) {
  const d = deedFor(board, space, s);
  if (!d) return null;
  const band = d.kind === 'street' ? safeColor(d.colour) : undefined;
  const titleId = `deed-${space}-title`;
  const kicker = board.heroes ? capital(termsOf(board).property) : 'Title deed';
  return (
    <article className={`title-deed ${d.kind}${d.mortgaged ? ' mortgaged' : ''}`} aria-labelledby={titleId}>
      <header className="deed-head" style={band ? { background: band } : undefined}>
        <span className="deed-kicker">{d.kind === 'street' ? kicker : d.kind === 'rail' ? 'Station' : 'Board'}</span>
        <h3 id={titleId}>{d.name}</h3>
        {d.villain && <span className="deed-villain">Villain: {d.villain}</span>}
        <span className="deed-price">{money(d.price, board)}</span>
      </header>
      {d.mortgaged && <p className="deed-stamp">Mortgaged</p>}
      <table className="deed-rent">
        <caption className="sr-only">{capital(termsOf(board).rent)}</caption>
        <tbody>
          {d.rent.map((r) => (
            <tr key={r.label} className={r.active ? 'active' : undefined} aria-current={r.active ? 'true' : undefined}>
              <th scope="row">{r.label}</th>
              <td className="money">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.note && <p className="deed-note muted">{d.note}</p>}
      {!compact && d.costs.length > 0 && (
        <table className="deed-costs">
          <caption className="sr-only">Costs</caption>
          <tbody>
            {d.costs.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="money">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
