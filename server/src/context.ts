import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { makeSubiektAdapter } from "./adapters/index.js";

/** Współdzielony adapter odczytu (Subiekt). Zapis idzie przez kolejkę/worker. */
export const subiekt = makeSubiektAdapter();

function header(req: FastifyRequest, name: string): string | null {
  const h = req.headers[name];
  const val = Array.isArray(h) ? h[0] : h;
  return (val && String(val).trim()) || null;
}

/**
 * Kto wykonuje operację.
 *
 * Pierwszeństwo ma SESJA (skan badge'a zweryfikowany przez serwer). Nagłówek
 * `X-User` zostaje wyłącznie jako podpowiedź dla instalacji, które nie przeszły
 * jeszcze na badge'y — bo dało się go wpisać ręcznie, więc nigdy nie był
 * dowodem tożsamości, tylko deklaracją.
 */
export function userOf(req: FastifyRequest): string {
  return currentUserName() ?? header(req, "x-user") ?? "anonim";
}

/* ── Kontekst żądania ───────────────────────────────────────────────────────
   `device_id` jest polem DIAGNOSTYCZNYM: przy współdzielonych kolektorach
   pierwsze pytanie przy awarii brzmi „to jedno urządzenie czy wszystkie?",
   a bez zapisu nie da się na nie odpowiedzieć po fakcie.

   Przeciągnięcie go przez ~24 wywołania `logEvent` — w tym przez warstwę
   usług, które o żądaniu nic nie wiedzą — kosztowałoby więcej niż wnosi.
   Dlatego kontekst żyje w AsyncLocalStorage: hook ustawia go raz na żądanie,
   a `logEvent` po prostu go widzi. Poza żądaniem (worker) jest pusty i to
   jest poprawna odpowiedź, nie brak danych.                                  */

interface ReqCtx {
  device: string | null;
  /** Token sesji urządzenia — tożsamość rozstrzyga serwer, nie nagłówek. */
  token: string | null;
  /** Konto ustalone z tokenu; wypełniane leniwie, żeby nie pytać bazy bez potrzeby. */
  userRef?: number | null;
  userName?: string | null;
}

const store = new AsyncLocalStorage<ReqCtx>();

/** Urządzenie bieżącego żądania; null poza żądaniem albo bez nagłówka. */
export const currentDevice = (): string | null => store.getStore()?.device ?? null;

/** Token sesji bieżącego żądania. */
export const currentToken = (): string | null => store.getStore()?.token ?? null;

/** Konto z sesji — `logEvent` wpisuje je do `events.user_ref`. */
export const currentUserRef = (): number | null => store.getStore()?.userRef ?? null;

/** Ustawiane przez hook uwierzytelnienia po rozpoznaniu tokenu. */
export function setCurrentUser(userId: number, name: string): void {
  const ctx = store.getStore();
  if (ctx) {
    ctx.userRef = userId;
    ctx.userName = name;
  }
}

/** Nazwa z sesji, gdy jest — inaczej nagłówek `X-User` jako podpowiedź. */
export const currentUserName = (): string | null => store.getStore()?.userName ?? null;

export function withRequestContext(app: FastifyInstance): void {
  app.addHook("onRequest", (req, _reply, done) => {
    store.run({ device: header(req, "x-device"), token: header(req, "x-session") }, done);
  });
  // Rozpoznanie sesji osobnym hookiem, PO ustawieniu kontekstu: dopiero tu
  // wolno dotknąć bazy, a `services/auth` importuje `context`, więc import
  // musi być leniwy (inaczej cykl).
  app.addHook("preHandler", async (req) => {
    const t = currentToken();
    if (!t) return;
    const { sesja, dotknij } = await import("./services/auth.js");
    const s = sesja(t);
    if (!s) return;
    setCurrentUser(s.user.userId, s.user.name);
    // każde żądanie odsuwa blokadę — praca trwa, więc sesja nie ma prawa wygasać
    if (!s.zablokowana) dotknij(t);
    void req;
  });
}
