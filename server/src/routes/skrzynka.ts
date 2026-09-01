import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import { kontekstRozmowy, listaRozmow, zadaniaPomiarowe, zapiszWynikPomiaru, zlecPomiar } from "../services/skrzynka.js";

export async function skrzynkaRoutes(app: FastifyInstance) {
  app.get("/api/obsluga/rozmowy", async (_req, reply) => {
    try { return { conversations: await listaRozmow() }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message, code:"sync_error" }); }
  });
  app.get<{Params:{id:string}}>("/api/obsluga/rozmowy/:id", async (req, reply) => {
    try { return await kontekstRozmowy(req.params.id); }
    catch (e) { return reply.code(502).send({ error:(e as Error).message, code:"sync_error" }); }
  });
  app.post<{Body:{conversationId?:string;sourceMessageId?:string}}>("/api/obsluga/zadania/pomiar", async (req, reply) => {
    const s = sesjaZadania();
    if (!s) return reply.code(401).send({error:"Brak sesji — zaloguj się"});
    try { return reply.code(201).send(await zlecPomiar(req.body?.conversationId ?? "", req.body?.sourceMessageId ?? "", s.user.name)); }
    catch (e) { return reply.code(400).send({error:(e as Error).message}); }
  });
  /* Kolektor dostaje ten sam zamknięty kontekst, który powstał z wiadomości.
     Nie ma pola ani trasy pozwalającej operatorowi podmienić `twId`. */
  app.get("/api/field-tasks", async () => ({ tasks: zadaniaPomiarowe() }));
  app.post<{Params:{id:string};Body:{result?:string}}>("/api/field-tasks/:id/result", async (req, reply) => {
    const s = sesjaZadania();
    if (!s) return reply.code(401).send({error:"Brak sesji — zaloguj się"});
    try { return zapiszWynikPomiaru(Number(req.params.id), req.body?.result ?? "", s.user.name); }
    catch (e) { return reply.code(400).send({error:(e as Error).message}); }
  });
}
