import { useSyncExternalStore } from "react";
import { getUser, setUser } from "./api";

/* ── Użytkownicy kolektora (spec §8) ────────────────────────────────────────
   Jedno urządzenie obsługuje kilku magazynierów (zmiany, hot-swap). Lista
   użytkowników trzymana w localStorage; wybrany trafia do nagłówka X-User,
   więc każda operacja w events/kolejce jest przypisana do właściwej osoby.  */

const KEY = "wertis_users";
export const MAX_USER_LEN = 24;

export interface UsersState {
  list: string[];
  current: string;
}

function loadList(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(raw)) {
      const list = [
        ...new Set(
          raw
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim())
            .filter(Boolean)
        ),
      ];
      if (list.length) return list;
    }
  } catch {
    /* uszkodzony zapis — start od bieżącego użytkownika */
  }
  // migracja: dotychczasowy pojedynczy użytkownik (wertis_user) staje się listą
  return [getUser()];
}

let state: UsersState = (() => {
  const list = loadList();
  const current = getUser();
  return { list: list.includes(current) ? list : [...list, current], current };
})();

const listeners = new Set<() => void>();

function persist() {
  localStorage.setItem(KEY, JSON.stringify(state.list));
  setUser(state.current);
  listeners.forEach((l) => l());
}

export function getUsers(): UsersState {
  return state;
}

/** Dodaj użytkownika (lub wskaż istniejącego o tej nazwie) i ustaw jako aktywnego. */
export function addUser(name: string): string | null {
  const n = name.trim().slice(0, MAX_USER_LEN);
  if (!n) return null;
  const existing = state.list.find((u) => u.toLowerCase() === n.toLowerCase());
  state = {
    list: existing ? state.list : [...state.list, n],
    current: existing ?? n,
  };
  persist();
  return state.current;
}

export function selectUser(name: string) {
  if (!state.list.includes(name) || state.current === name) return;
  state = { ...state, current: name };
  persist();
}

/** Usuń z listy; zawsze musi zostać co najmniej jeden użytkownik. */
export function removeUser(name: string) {
  if (state.list.length <= 1) return;
  const list = state.list.filter((u) => u !== name);
  state = { list, current: state.current === name ? list[0] : state.current };
  persist();
}

export function subscribeUsers(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function useUsers(): UsersState {
  return useSyncExternalStore(subscribeUsers, getUsers);
}

/** Inicjały do awatara w pasku (np. „Jan Kowalski" → JK). */
export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
