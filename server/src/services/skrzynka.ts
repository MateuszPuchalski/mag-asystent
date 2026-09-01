import { config } from "../config.js";
import { db } from "../db/db.js";
import { zapytajAllegro, urlWatkow, urlWiadomosci } from "../adapters/allegro.http.js";
import { logEvent } from "./events.js";

export interface WiadomoscSkrzynki {
  id: string; autor: "klient" | "agent" | "system"; tresc: string; utworzono: string;
  offerId: string | null; offerTitle: string | null; twId: number | null; productName: string | null;
  kind: "message" | "field_result"; fieldTaskId?: number; result?: string;
}
export interface RozmowaSkrzynki { id: string; klient: string; temat: string; ostatniaWiadomosc: string; updatedAt: string; unread: boolean; syncError?: string }

const tekst = (v: unknown) => typeof v === "string" ? v : "";
const obiekt = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const tablica = (v: unknown, klucze: string[]) => { const o = obiekt(v); for (const k of klucze) if (Array.isArray(o[k])) return o[k] as unknown[]; return []; };
const data = (o: Record<string, unknown>) => tekst(o.createdAt) || tekst(o.updatedAt) || new Date(0).toISOString();
const oferta = (o: Record<string, unknown>) => obiekt(o.offer ?? o.subject);

export async function listaRozmow(): Promise<RozmowaSkrzynki[]> {
  if ((config.allegro.mode ?? (config.sgtMode === "mssql" ? "http" : "dev")) === "dev") return demoRozmowy;
  const raw = await zapytajAllegro(urlWatkow(config.allegro.apiUrl, 0));
  return tablica(raw, ["threads", "items"]).map((v) => {
    const o = obiekt(v); const ostatnia = obiekt(o.lastMessage); const interlocutor = obiekt(o.interlocutor);
    return { id: tekst(o.id), klient: tekst(interlocutor.login) || tekst(interlocutor.id) || "Klient Allegro", temat: tekst(o.subject) || tekst(oferta(ostatnia).name) || "Rozmowa", ostatniaWiadomosc: tekst(ostatnia.text) || tekst(ostatnia.content) || "", updatedAt: data(ostatnia), unread: Boolean(o.read === false || o.unread) };
  }).filter((x) => x.id);
}

export async function kontekstRozmowy(id: string): Promise<{ conversation: RozmowaSkrzynki; messages: WiadomoscSkrzynki[] }> {
  const rozmowy = await listaRozmow();
  const conversation = rozmowy.find((x) => x.id === id);
  if (!conversation) throw new Error("Nie znaleziono rozmowy");
  let messages: WiadomoscSkrzynki[];
  if (id === "demo-1") messages = demoWiadomosci;
  else {
    const raw = await zapytajAllegro(urlWiadomosci(config.allegro.apiUrl, id));
    messages = tablica(raw, ["messages", "items"]).map((v) => {
      const o = obiekt(v); const author = obiekt(o.author); const off = oferta(o); const external = obiekt(off.external);
      const twId = Number(external.id);
      return { id: tekst(o.id), autor: tekst(author.role).toUpperCase() === "SELLER" ? "agent" : "klient", tresc: tekst(o.text) || tekst(o.content), utworzono: data(o), offerId: tekst(off.id) || null, offerTitle: tekst(off.name) || null, twId: Number.isInteger(twId) && twId > 0 ? twId : null, productName: tekst(off.name) || null, kind: "message" };
    });
  }
  const wyniki = db().prepare(`SELECT id, source_message_id, result, completed_at FROM field_task WHERE conversation_id=? AND status='done' ORDER BY completed_at`).all(id) as Array<{id:number;source_message_id:string;result:string;completed_at:string}>;
  messages.push(...wyniki.map((w) => ({ id:`field-${w.id}`, autor:"system" as const, tresc:"", utworzono:w.completed_at, offerId:null, offerTitle:null, twId:null, productName:null, kind:"field_result" as const, fieldTaskId:w.id, result:w.result })));
  messages.sort((a,b) => a.utworzono.localeCompare(b.utworzono));
  return { conversation, messages };
}

export async function zlecPomiar(conversationId: string, sourceMessageId: string, autor: string) {
  const { messages } = await kontekstRozmowy(conversationId);
  const source = messages.find((m) => m.id === sourceMessageId && m.kind === "message");
  if (!source) throw new Error("Wiadomość źródłowa nie należy do tej rozmowy");
  if (!source.offerId || !source.twId) throw new Error("Brak powiązania z ofertą i kartoteką — nie można zlecić pomiaru");
  const result = db().prepare(`INSERT INTO field_task(conversation_id, source_message_id, offer_id, tw_id, question, status, created_by) VALUES (?,?,?,?,?,'pending',?)`).run(conversationId, source.id, source.offerId, source.twId, source.tresc, autor);
  const id = Number(result.lastInsertRowid);
  logEvent("field_task_created", autor, source.twId, { fieldTaskId:id, conversationId, sourceMessageId:source.id, offerId:source.offerId });
  return { id, conversationId, sourceMessageId:source.id, offerId:source.offerId, twId:source.twId, status:"pending" };
}

export function zadaniaPomiarowe() {
  return db().prepare(
    `SELECT id, conversation_id AS conversationId, source_message_id AS sourceMessageId,
            offer_id AS offerId, tw_id AS twId, question, created_at AS createdAt
       FROM field_task WHERE status='pending' ORDER BY created_at, id`
  ).all();
}

export function zapiszWynikPomiaru(id: number, result: string, autor: string) {
  const tresc = result.trim();
  if (!tresc) throw new Error("Wynik pomiaru nie może być pusty");
  const zadanie = db().prepare(`SELECT tw_id AS twId FROM field_task WHERE id=? AND status='pending'`).get(id) as {twId:number}|undefined;
  if (!zadanie) throw new Error("Zadanie nie istnieje albo ma już wynik");
  db().prepare(`UPDATE field_task SET status='done', result=?, completed_at=datetime('now') WHERE id=?`).run(tresc, id);
  logEvent("field_task_completed", autor, zadanie.twId, { fieldTaskId:id, result:tresc });
  return { ok:true, id };
}

const demoRozmowy: RozmowaSkrzynki[] = [
  { id:"demo-1", klient:"zielony_ogrod", temat:"Rozrusznik do kosiarki", ostatniaWiadomosc:"Czy możecie zmierzyć rozstaw otworów?", updatedAt:"2026-08-31T08:42:00Z", unread:true },
  { id:"demo-2", klient:"anna.g", temat:"Termin dostawy", ostatniaWiadomosc:"Dziękuję za informację.", updatedAt:"2026-08-30T15:10:00Z", unread:false },
];
const demoWiadomosci: WiadomoscSkrzynki[] = [
  { id:"msg-1", autor:"klient", tresc:"Dzień dobry, czy możecie zmierzyć rozstaw otworów?", utworzono:"2026-08-31T08:42:00Z", offerId:"14900230123", offerTitle:"Rozrusznik kosiarki GCV", twId:1042, productName:"Rozrusznik kompletny GCV", kind:"message" },
];
