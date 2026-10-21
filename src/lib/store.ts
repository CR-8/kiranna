import { useSyncExternalStore } from 'react';

import * as E from './engine';
import './storage';

// ponytail: whole state is one JSON snapshot in localStorage — fine for a catalog + a few thousand bills.
// Swap `commit`'s write for Appwrite/Postgres-backed repositories when the backend lands.
const KEY = 'kirana.v1';

function load(): E.State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s?.v === 1) return s as E.State;
      } catch {
        localStorage.setItem(KEY + '.corrupt', raw); // never overwrite unreadable data silently
      }
    }
  } catch {
    // storage blocked: run in memory only
  }
  const fresh = E.newState(E.uid(), Date.now());
  persist(fresh);
  return fresh;
}

function persist(s: E.State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('Could not persist state', e);
  }
}

let state: E.State = load();
const listeners = new Set<() => void>();

function commit(next: E.State) {
  state = next;
  persist(next);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useApp = () => useSyncExternalStore(subscribe, () => state);

// One-line confirmation ("SAVED ON THIS PHONE") that survives a screen change; not persisted.
let notice = '';
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const noticeListeners = new Set<() => void>();
export function flash(msg: string) {
  notice = msg;
  noticeListeners.forEach((l) => l());
  clearTimeout(noticeTimer);
  if (msg) noticeTimer = setTimeout(() => flash(''), 3000);
}
export const useNotice = () =>
  useSyncExternalStore(
    (l) => {
      noticeListeners.add(l);
      return () => noticeListeners.delete(l);
    },
    () => notice,
  );

// Every mutation goes through the pure engine; invalid input throws E.EngineError and leaves state untouched.
export const actions = {
  startSale: () => {
    const r = E.startSale(state, Date.now());
    commit(r.state);
    return r.id;
  },
  addItem: (saleId: string, productId: string, qty?: number) => commit(E.addItem(state, saleId, productId, qty)),
  setQty: (saleId: string, itemId: string, qty: number) => commit(E.setItemQty(state, saleId, itemId, qty)),
  removeItem: (saleId: string, itemId: string) => commit(E.removeItem(state, saleId, itemId)),
  replaceItem: (saleId: string, itemId: string, productId: string) =>
    commit(E.replaceItem(state, saleId, itemId, productId)),
  discardSale: (saleId: string) => commit(E.discardSale(state, saleId)),
  confirmSale: (saleId: string, pay: E.PayMethod, override = false) =>
    commit(E.confirmSale(state, saleId, pay, Date.now(), override)),
  addProduct: (input: E.NewProduct) => {
    const r = E.addProduct(state, input, Date.now());
    commit(r.state);
    return r.id;
  },
  restock: (productId: string, qty: number, costPaise?: number) =>
    commit(E.restock(state, productId, qty, costPaise, Date.now())),
  setSettings: (p: Partial<Pick<E.State, 'shopName' | 'lang'>>) => commit({ ...state, ...p }),
};
