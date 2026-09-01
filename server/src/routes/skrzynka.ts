import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { logEvent } from "../services/events.js";
import { listaRozmow, osRozmowy, stanSkrzynki, zlecPomiar } from "../services/skrzynka.js";
import { ConversationConflict, dodajKomentarz, przejmijRozmowe, przekazRozmowe, wskazOferte, zapiszSzkic } from "../services/conversations.js";
import { onConversationEvent, setTyping, typingPresence } from "../services/conversation-realtime.js";
import { autoryzuj } from "../services/auth.js";
import { config } from "../config.js";
import { db } from "../db/db.js";
import { stanSynchronizacji } from "../services/allegro-inbox-sync-state.js";
import { synchronizujAllegroInbox } from "../services/allegro-inbox-sync.js";

const BIURO = ["biuro", "admin"];
const blad = (reply: FastifyReply, e: unknown) =>
  reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });

/* Skrzynka jest ekranem biura, więc bramka roli stoi na każdej trasie — także
   na odczycie. Rozmowy z klientami nie są danymi, które ma widzieć hala. */
function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Skrzynkę obsługuje biuro" });
  }
  return null;
}

export async function skrzynkaRoutes(app: FastifyInstance) {
  const konflikt = (reply: FastifyReply, e: unknown) => e instanceof ConversationConflict
    ? reply.code(409).send({ error: e.message, ...e.details }) : blad(reply, e);
  app.get("/api/obsluga/rozmowy", async (_req, reply) =>
    odmowa(reply) ?? { rozmowy: listaRozmow(), stan: stanSkrzynki() });

  app.get<{ Params: { id: string } }>("/api/obsluga/rozmowy/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try { return osRozmowy(Number(req.params.id)); } catch (e) { return blad(reply, e); }
  });

  app.post<{ Body: { rozmowaId?: number; wiadomoscId?: number; instrukcja?: string; twId?: number | null } }>(
    "/api/obsluga/zadania/pomiar", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const s = sesjaZadania()!;
      try {
        return {
          zadanie: zlecPomiar(
            Number(req.body?.rozmowaId), Number(req.body?.wiadomoscId),
            req.body?.instrukcja ?? "", { id: s.user.userId, name: s.user.name },
            req.body?.twId ?? null,
          ),
        };
      } catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { expectedVersion?: number } }>(
    "/api/conversations/:id/claim", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return przejmijRozmowe(Number(req.params.id), sesjaZadania()!.user.userId,
        Number(req.body?.expectedVersion)); } catch (e) { return konflikt(reply, e); }
    });

  app.put<{ Params: { id: string }; Body: { body?: string; expectedLastMessageId?: number | null; expectedVersion?: number | null } }>(
    "/api/conversations/:id/draft", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return zapiszSzkic(Number(req.params.id), sesjaZadania()!.user.userId,
        req.body?.body ?? "", req.body?.expectedLastMessageId ?? null,
        req.body?.expectedVersion ?? null); } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { body?: string; mentionedUserIds?: number[] } }>(
    "/api/conversations/:id/comments", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return dodajKomentarz(Number(req.params.id), sesjaZadania()!.user.userId,
        req.body?.body ?? "", req.body?.mentionedUserIds ?? []); } catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { typing?: boolean } }>(
    "/api/conversations/:id/presence", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const user = sesjaZadania()!.user;
      setTyping(Number(req.params.id), user.userId, user.name, Boolean(req.body?.typing));
      return { presence: typingPresence(Number(req.params.id)) };
    });

  /* Ręczna synchronizacja (§9). NIE omija przerwy: gdy Allegro poprosiło
     o `Retry-After`, przycisk skraca tylko czekanie po jej końcu. Omijanie
     przerwy kosztowałoby konto — a agent klika wtedy, gdy najbardziej mu
     zależy, czyli dokładnie w środku limitu. */
  app.post("/api/obsluga/synchronizuj", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    if (!config.allegro.clientId) {
      return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
    }
    const stan = stanSynchronizacji(db());
    if (stan.nextAttemptAt && Date.parse(stan.nextAttemptAt) > Date.now()) {
      return reply.code(409).send({
        error: "Allegro prosi o przerwę — synchronizacja czeka",
        nastepnaProba: stan.nextAttemptAt,
      });
    }
    const s = sesjaZadania()!;
    logEvent("skrzynka_synchronizacja_reczna", s.user.name);
    try {
      await synchronizujAllegroInbox();
      return { stan: stanSynchronizacji(db()) };
    } catch (e) { return blad(reply, e); }
  });

  /* Wymuszone przekazanie — odebranie rozmowy komuś z rąk. Rola i powód
     stoją tutaj, bo to trasa decyduje o uprawnieniu (wzorzec z domknięcia
     dostawy), a serwis pilnuje wersji i kompletu zapisu. */
  app.post<{ Params: { id: string }; Body: { doUserId?: number | null; powod?: string; expectedVersion?: number } }>(
    "/api/conversations/:id/assign", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const s = sesjaZadania()!;
      const zgoda = autoryzuj(s.user, "wymuszone_przekazanie");
      if (!zgoda.ok) return reply.code(403).send({ error: zgoda.powod });
      try {
        return przekazRozmowe(Number(req.params.id), s.user.userId,
          req.body?.doUserId ?? null, req.body?.powod ?? "", Number(req.body?.expectedVersion));
      } catch (e) { return konflikt(reply, e); }
    });

  /* Ręczne wskazanie oferty. Pytanie bez numeru oferty zostaje pytaniem bez
     numeru — ekran nie zgaduje towaru z najdłuższych słów treści. */
  app.post<{ Params: { id: string }; Body: { ofertaId?: string } }>(
    "/api/conversations/:id/oferta", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return wskazOferte(Number(req.params.id), req.body?.ofertaId ?? "",
          sesjaZadania()!.user.userId);
      } catch (e) { return blad(reply, e); }
    });

  // SSE: jedna szyna dla obecności, wiadomości, przypisań i wyników magazynu.
  app.get<{ Querystring: { conversationId?: string } }>("/api/conversations/events", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const filter = req.query.conversationId ? Number(req.query.conversationId) : null;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache",
      connection: "keep-alive", "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const off = onConversationEvent((event) => {
      if (filter !== null && event.conversationId !== filter) return;
      reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => reply.raw.write(": keep-alive\n\n"), 15_000);
    req.raw.on("close", () => { clearInterval(keepAlive); off(); });
  });
}
