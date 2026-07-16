import type { FastifyRequest } from "fastify";
import { makeSubiektAdapter } from "./adapters/index.js";

/** Współdzielony adapter odczytu (Subiekt). Zapis idzie przez kolejkę/worker. */
export const subiekt = makeSubiektAdapter();

/** Identyfikacja użytkownika kolektora (spec §8) — nagłówek X-User. */
export function userOf(req: FastifyRequest): string {
  const u = req.headers["x-user"];
  const val = Array.isArray(u) ? u[0] : u;
  return (val && String(val).trim()) || "anonim";
}
