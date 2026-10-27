import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_IDS } from '../../rules';
import { boardTheme } from '../boardThemes';
import { boardTokens, DEFAULT_TOKEN, TOKENS, tokenOn } from '../tokens';

describe('tokens and board themes', () => {
  it('every board has eight tokens and eight bot names of its own', () => {
    const seen = new Set<string>();
    for (const b of BOARD_IDS) {
      const t = boardTheme(b);
      expect(t.tokens).toHaveLength(8);
      expect(new Set(t.botNames).size).toBe(8);
      for (const id of t.tokens) {
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(TOKENS.length);
    expect(boardTokens('lanka')[0]).toBe(DEFAULT_TOKEN);
  });

  it('a token from another board shows as the same slot of this board, so seats stay unique', () => {
    for (const from of BOARD_IDS) {
      for (const to of BOARD_IDS) {
        const mapped = boardTokens(from).map((id) => tokenOn(to, id));
        expect(mapped).toEqual(boardTokens(to));
      }
    }
  });

  it('the database accepts exactly these token ids', () => {
    const rules = readFileSync(new URL('../../../database.rules.json', import.meta.url), 'utf8');
    const listed = [...rules.matchAll(/newData\.val\(\) === '([A-Za-z]+)'/g)].map((m) => m[1]);
    for (const t of TOKENS) expect(listed, t.id).toContain(t.id);
  });
});
