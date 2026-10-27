import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_IDS, createGame, getBoard, HEROES } from '../../rules';
import { LANKA_THEME } from '../../boards/lanka/theme';
import { boardTheme } from '../boardThemes';
import { boardTokens, DEFAULT_TOKEN, freeTokens, pickFreeToken, seatToken, TOKENS, tokenOn, tokensOn } from '../tokens';

describe('tokens and board themes', () => {
  it('every board has a token and a bot name of its own for each seat it has', () => {
    const seen = new Set<string>();
    for (const b of BOARD_IDS) {
      const t = boardTheme(b);
      // Eight on the classic boards, Hero League's six heroes
      expect(t.tokens).toHaveLength(getBoard(b).heroes ? 6 : 8);
      expect(t.tokens.length).toBeGreaterThanOrEqual(getBoard(b).maxPlayers);
      expect(new Set(t.botNames).size).toBe(t.tokens.length);
      for (const id of t.tokens) {
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(TOKENS.length);
    expect(boardTokens('lanka')[0]).toBe(DEFAULT_TOKEN);
  });

  it("Hero League's tokens are its heroes, in the Hero die's face order", () => {
    expect(boardTokens('heroes')).toEqual(HEROES.heroes!.list.map((h) => h.id));
    expect(boardTokens('heroes')).toEqual(['jadeTitan', 'starCaptain', 'steelAce', 'stormLord', 'velvetViper', 'sharpshot']);
  });

  it('Hero League has no sounds of its own: All Island’s, with All Island’s loop', () => {
    expect(boardTheme('heroes')).toMatchObject({ sounds: '', loopSeconds: LANKA_THEME.loopSeconds });
    expect(boardTheme('lanka').sounds).toBe('');
    for (const b of ['colombo', 'hill', 'south']) expect(boardTheme(b).sounds).toBe(b);
  });

  it('a token from another board shows as the same slot of this board, so seats stay unique', () => {
    for (const from of BOARD_IDS) {
      for (const to of BOARD_IDS) {
        const n = Math.min(boardTokens(from).length, boardTokens(to).length);
        const mapped = boardTokens(from).slice(0, n).map((id) => tokenOn(to, id));
        expect(mapped, `${from} -> ${to}`).toEqual(boardTokens(to).slice(0, n));
      }
    }
    // A slot the smaller set lacks wraps around to its start
    expect(tokenOn('heroes', 'oruwa')).toBe('jadeTitan');
    expect(tokenOn('heroes', 'kite')).toBe('starCaptain');
    expect(tokenOn('lanka', 'sharpshot')).toBe('drum');
  });

  it('a whole table moves to another board without two seats on one token, whatever the set sizes', () => {
    for (const from of BOARD_IDS) {
      for (const to of BOARD_IDS) {
        const set = boardTokens(from).slice(0, getBoard(to).maxPlayers);
        const mapped = tokensOn(to, set);
        expect(new Set(mapped).size, `${from} -> ${to}`).toBe(set.length);
        for (const t of mapped) expect(boardTokens(to)).toContain(t);
        // ...and every seat whose slot the new set has keeps it
        set.forEach((id, i) => {
          if (i < boardTokens(to).length) expect(mapped[i]).toBe(tokenOn(to, id));
        });
      }
    }
  });

  it('tokensOn: seats without a slot on the board take its free tokens in slot order', () => {
    // Seven All Island seats with the canoe and the kite, two of them removed later: the heroes left over go to them
    expect(tokensOn('heroes', ['oruwa', 'tuktuk', 'kite', 'coconut'])).toEqual(['starCaptain', 'jadeTitan', 'stormLord', 'steelAce']);
    // Two seats on one slot (from different boards): the first keeps it
    expect(tokensOn('lanka', ['cityBus', 'tuktuk'])).toEqual(['tuktuk', 'elephant']);
    // Already the board's own and unique: unchanged
    expect(tokensOn('lanka', boardTokens('lanka'))).toEqual(boardTokens('lanka'));
    // Only a table larger than the set repeats any
    const eight = tokensOn('heroes', boardTokens('lanka'));
    expect(eight.slice(0, 6)).toEqual(boardTokens('heroes'));
    expect(eight.slice(6)).toEqual(['jadeTitan', 'starCaptain']);
  });

  it('freeTokens lists the tokens nobody at the table holds, as the board shows the table', () => {
    expect(freeTokens('heroes', ['tuktuk', 'stormLord'])).toEqual(['starCaptain', 'steelAce', 'velvetViper', 'sharpshot']);
    expect(freeTokens('heroes', boardTokens('heroes'))).toEqual([]);
    expect(freeTokens('lanka', [])).toEqual(boardTokens('lanka'));
  });

  it('a new seat takes the first free token, or on Hero League a random free hero; none once all are held', () => {
    // The free heroes here: starCaptain, steelAce, velvetViper, sharpshot
    const held = ['tuktuk', 'stormLord'];
    expect(pickFreeToken('heroes', held, () => 0)).toBe('starCaptain');
    expect(pickFreeToken('heroes', held, () => 0.5)).toBe('velvetViper');
    expect(pickFreeToken('heroes', held, () => 0.999)).toBe('sharpshot');
    expect(pickFreeToken('heroes', boardTokens('heroes'), () => 0)).toBeUndefined();
    // The classic boards draw nothing: the first free token, as before
    const never = () => {
      throw new Error('no draw on a classic board');
    };
    for (const b of ['lanka', 'colombo', 'hill', 'south']) {
      expect(pickFreeToken(b, [boardTokens(b)[0]!, boardTokens(b)[2]!], never)).toBe(boardTokens(b)[1]);
      expect(pickFreeToken(b, boardTokens(b), never)).toBeUndefined();
    }
  });

  it('a seat shows the hero it plays on Hero League, else the token it picked', () => {
    const seats = [
      { id: 's0', name: 'A', hero: 'sharpshot' },
      { id: 's1', name: 'B', hero: 'jadeTitan' },
    ] as const;
    const heroes = createGame({ board: 'heroes' }, [...seats], 1).state;
    expect(seatToken(heroes, 's0', 'tuktuk')).toBe('sharpshot');
    expect(seatToken(heroes, 's1', undefined)).toBe('jadeTitan');
    const lanka = createGame({}, [{ id: 's0', name: 'A' }, { id: 's1', name: 'B' }], 1).state;
    expect(seatToken(lanka, 's0', 'elephant')).toBe('elephant');
    expect(seatToken(lanka, 's1', undefined)).toBeUndefined();
    expect(seatToken(null, 's0', 'kite')).toBe('kite');
  });

  it('the database accepts exactly these token ids', () => {
    const rules = readFileSync(new URL('../../../database.rules.json', import.meta.url), 'utf8');
    const listed = [...rules.matchAll(/newData\.val\(\) === '([A-Za-z]+)'/g)].map((m) => m[1]);
    for (const t of TOKENS) expect(listed, t.id).toContain(t.id);
  });

  it('the database accepts every board id', () => {
    const rules = JSON.parse(readFileSync(new URL('../../../database.rules.json', import.meta.url), 'utf8')) as {
      rules: { lobby: { $room: { board: { '.validate': string } } }; rooms: { $room: { setup: { rules: { board: { '.validate': string } } } } } };
    };
    for (const rule of [rules.rules.lobby.$room.board['.validate'], rules.rules.rooms.$room.setup.rules.board['.validate']]) {
      const listed = [...rule.matchAll(/newData\.val\(\) === '([A-Za-z]+)'/g)].map((m) => m[1]);
      expect(listed.sort()).toEqual([...BOARD_IDS].sort());
    }
  });
});
