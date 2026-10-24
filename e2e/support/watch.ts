import { expect, type Page } from '@playwright/test';

/*
 * What a page did that it shouldn't have: console and page errors, requests to the database emulator (:9000) in an
 * offline game, and anything fetched from beyond this machine (the game bundles everything; Discord's CSP would
 * block a CDN anyway).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface Watch {
  errors: string[];
  /** Requests and sockets to the database emulator */
  db: string[];
  /** Requests and sockets to any other host */
  remote: string[];
  /** Nothing of the above happened */
  check(o?: { online?: boolean }): void;
}

export function watch(page: Page): Watch {
  const w: Watch = {
    errors: [],
    db: [],
    remote: [],
    check({ online = false } = {}) {
      if (!online) expect(w.db, 'requests to the database emulator').toEqual([]);
      expect(w.remote, 'requests to other hosts').toEqual([]);
      expect(w.errors, 'console and page errors').toEqual([]);
    },
  };
  const seen = (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (!LOCAL_HOSTS.has(url.hostname)) w.remote.push(raw);
    else if (url.port === '9000') w.db.push(raw);
  };
  page.on('console', (msg) => {
    if (msg.type() === 'error') w.errors.push(msg.text());
  });
  page.on('pageerror', (err) => w.errors.push(err.message));
  page.on('request', (req) => seen(req.url()));
  page.on('websocket', (ws) => seen(ws.url()));
  return w;
}
