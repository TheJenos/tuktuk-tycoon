import { useMemo, useState } from 'react';
import { buildOptions, isProperty, isStreet, unmortgageCost, type GameState, type SeatId } from '../../../rules';
import { safeColor } from '../../colors';
import { useBusy, useSend } from '../actions';
import { useGame, useMySeats, useNames } from '../context';
import { Dialog } from '../Dialog';
import { levelText, money, plural, signedMoney, type Names } from '../format';
import {
  EMPTY_PLAN,
  mortgageProblem,
  normalizePlan,
  planEmpty,
  planSummary,
  stepLevel,
  stepProblem,
  targetLevel,
  targetMortgaged,
  toggleMortgage,
  type Plan,
} from './buildPlan';

interface Props {
  seat: SeatId;
  onClose(): void;
  covered: boolean;
}

/**
 * Build, sell, mortgage and lift, staged: +/− per street (even building enforced, with a hint naming the street
 * to change first), mortgage toggles with their amounts, the bank's stock and the cash change, then one Apply that
 * sends the actions in a safe order. Grouped by colour set; railroads and utilities at the end.
 */
export function ManageProperties({ seat: initial, onClose, covered }: Props) {
  const s = useGame();
  const mine = useMySeats();
  const names = useNames();
  const send = useSend();
  const busy = useBusy();
  const [seat, setSeat] = useState(initial);
  const [staged, setStaged] = useState<Plan>(EMPTY_PLAN);
  const [applying, setApplying] = useState(false);
  const live = s ? mine.filter((x) => s.players[x] && !s.players[x]?.out) : [];

  // Always against the latest state: what has been applied (or changed by others) drops out of the plan
  const plan = useMemo(() => (s ? normalizePlan(s, seat, staged) : EMPTY_PLAN), [s, seat, staged]);
  if (!s) return null;
  const sum = planSummary(s, seat, plan);
  const cash = s.players[seat]?.cash ?? 0;
  const options = buildOptions(s, seat);
  const others = names.board.spaces.flatMap((sp, i) => (isProperty(sp) && !isStreet(sp) && s.props[`p${i}`]?.owner === seat ? [i] : []));
  const nothing = options.length === 0 && others.length === 0;

  const apply = async () => {
    setApplying(true);
    try {
      for (const a of sum.actions) {
        const r = await send(seat, a);
        if (!r.ok) break;
      }
    } finally {
      setApplying(false);
    }
  };
  const update = (next: Plan) => setStaged(next);

  return (
    <Dialog
      id="manage"
      className="manage"
      title="Manage properties"
      onClose={onClose}
      covered={covered}
      aside={
        live.length > 1 ? (
          <span className="choices" role="radiogroup" aria-label="Player">
            {live.map((x) => (
              <button key={x} type="button" role="radio" aria-checked={x === seat} className={x === seat ? 'chip selected' : 'chip'} onClick={() => { setSeat(x); setStaged(EMPTY_PLAN); }}>
                {names.seat(x)}
              </button>
            ))}
          </span>
        ) : undefined
      }
      footer={
        <>
          <span className="manage-summary">
            <span>
              Cash {money(cash)}
              {sum.cash !== 0 && <> → <strong className={sum.cash > 0 ? 'money up' : 'money down'}>{money(cash + sum.cash)}</strong></>}
            </span>
            {sum.problems.map((p) => (
              <span key={p} className="shortfall" role="status">{p}</span>
            ))}
          </span>
          <button type="button" disabled={planEmpty(plan) || applying} onClick={() => setStaged(EMPTY_PLAN)}>
            Reset
          </button>
          <button type="button" className="primary" disabled={planEmpty(plan) || busy || applying || sum.problems.length > 0} onClick={() => void apply()}>
            Apply{sum.cash !== 0 && <>{' '}<span className="amt">({signedMoney(sum.cash)})</span></>}
          </button>
        </>
      }
    >
      <p className="bank-stock muted">
        Bank: {plural(s.bank.houses, 'house')} · {plural(s.bank.hotels, 'hotel')}
        {(sum.bankHouses !== s.bank.houses || sum.bankHotels !== s.bank.hotels) && (
          <> → {plural(Math.max(0, sum.bankHouses), 'house')} · {plural(Math.max(0, sum.bankHotels), 'hotel')}</>
        )}
      </p>
      {nothing && <p className="muted">{names.seat(seat)} owns no property yet.</p>}
      {options.map((o) => (
        <section key={o.group} className="manage-group" aria-label={o.name}>
          <header>
            <span className="band" style={{ background: safeColor(names.board.display.groupColours[o.group]) }} aria-hidden="true" />
            <h3>{o.name}</h3>
            {!plan.levels[o.group] && o.reason && <span className="muted small">{o.reason}</span>}
            {o.complete && <span className="muted small">{money(o.houseCost)} per house</span>}
          </header>
          <ul>
            {o.spaces.map((i) => (
              <SpaceRow key={i} s={s} seat={seat} plan={plan} space={i} names={names} onPlan={update} buildable />
            ))}
          </ul>
        </section>
      ))}
      {others.length > 0 && (
        <section className="manage-group" aria-label="Stations and boards">
          <header>
            <h3>Stations and boards</h3>
          </header>
          <ul>
            {others.map((i) => (
              <SpaceRow key={i} s={s} seat={seat} plan={plan} space={i} names={names} onPlan={update} buildable={false} />
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}

function SpaceRow({ s, seat, plan, space, names, onPlan, buildable }: {
  s: GameState; seat: SeatId; plan: Plan; space: number; names: Names; onPlan(p: Plan): void; buildable: boolean;
}) {
  const sp = names.board.spaces[space];
  const ps = s.props[`p${space}`];
  if (!isProperty(sp)) return null;
  if (ps?.owner !== seat) {
    return (
      <li className="space-row dim">
        <span className="space-name">{sp.name}</span>
        <span className="muted small">{ps ? `owned by ${names.seat(ps.owner)}` : 'not owned yet'}</span>
      </li>
    );
  }
  const now = ps.level;
  const target = targetLevel(s, plan, space);
  const down = stepProblem(s, seat, plan, space, -1);
  const up = stepProblem(s, seat, plan, space, 1);
  const mortgaged = targetMortgaged(s, plan, space);
  const changedM = mortgaged !== !!ps.mortgaged;
  const mProblem = mortgageProblem(s, seat, plan, space);
  return (
    <li className={changedM || target !== now ? 'space-row staged' : 'space-row'}>
      <span className="space-name">
        {sp.name}
        {mortgaged && <span className="badge danger">Mortgaged</span>}
      </span>
      {buildable && (
        <span className="stepper" role="group" aria-label={`Buildings on ${sp.name}`}>
          <button type="button" className="icon-button" disabled={!!down} title={down ?? 'Sell one level (half price back)'} aria-label={`Sell a building on ${sp.name}${down ? `: ${down}` : ''}`} onClick={() => onPlan(stepLevel(s, seat, plan, space, -1))}>
            −
          </button>
          <output className="level" aria-live="polite">
            {target === 5 ? 'Hotel' : target === 0 ? '—' : `${target} ${target === 1 ? 'house' : 'houses'}`}
            {target !== now && <small className="muted"> (now {levelText(now)})</small>}
          </output>
          <button type="button" className="icon-button" disabled={!!up} title={up ?? 'Build one level'} aria-label={`Build on ${sp.name}${up ? `: ${up}` : ''}`} onClick={() => onPlan(stepLevel(s, seat, plan, space, 1))}>
            +
          </button>
        </span>
      )}
      <button
        type="button"
        className={changedM ? 'chip selected mortgage-toggle' : 'chip mortgage-toggle'}
        disabled={!!mProblem}
        title={mProblem ?? undefined}
        aria-pressed={changedM}
        onClick={() => onPlan(toggleMortgage(s, seat, plan, space))}
      >
        {/* One inline run inside the flex chip, so it wraps like text with each amount kept whole; the spaces keep
            the names ("Mortgage for Rs. 10,000") */}
        <span>
          {changedM
            ? mortgaged
              ? <>Mortgage{' '}<span className="amt">+{money(sp.mortgage)}</span>{' '}(undo)</>
              : <>Lift{' '}<span className="amt">−{money(unmortgageCost(s, space))}</span>{' '}(undo)</>
            : mortgaged
              ? <>Lift for{' '}<span className="amt">{money(unmortgageCost(s, space))}</span></>
              : <>Mortgage for{' '}<span className="amt">{money(sp.mortgage)}</span></>}
        </span>
      </button>
    </li>
  );
}
