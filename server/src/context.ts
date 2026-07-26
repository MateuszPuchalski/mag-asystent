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

/** Identyfikacja użytkownika kolektora (spec §8) — nagłówek X-User. */
export function userOf(req: FastifyRequest): string {
  return header(req, "x-user") ?? "anonim";
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
}

const store = new AsyncLocalStorage<ReqCtx>();

/** Urządzenie bieżącego żądania; null poza żądaniem albo bez nagłówka. */
export const currentDevice = (): string | null => store.getStore()?.device ?? null;

export function withRequestContext(app: FastifyInstance): void {
  app.addHook("onRequest", (req, _reply, done) => {
    store.run({ device: header(req, "x-device") }, done);
  });
}
