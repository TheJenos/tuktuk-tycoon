import { isProperty } from '../../../rules';
import { useView } from '../../../view';
import { useGame, useNames } from '../context';
import { spaceBlurb } from './deed';
import { OwnerLine } from './TileInspector';
import { TitleDeed } from './TitleDeed';

/**
 * The previewed space's information, compact: its Title Deed without the costs and who owns it (or what a
 * non-property space does). Shown beside the list it was picked from while the board highlights the tile.
 */
export function PreviewCard({ space, className }: { space: number; className?: string }) {
  const shown = useView((v) => v.game);
  const logical = useGame();
  const names = useNames();
  const s = shown ?? logical;
  const sp = names.board.spaces[space];
  if (!sp || !s) return null;
  return (
    <section className={['preview-card', className].filter(Boolean).join(' ')} aria-label={`${sp.name} preview`}>
      {isProperty(sp) ? (
        <>
          <TitleDeed board={names.board} space={space} s={s} compact />
          <OwnerLine space={space} s={s} />
        </>
      ) : (
        <>
          <strong>{sp.name}</strong>
          <p className="blurb">{spaceBlurb(names.board, sp, s)}</p>
        </>
      )}
    </section>
  );
}
