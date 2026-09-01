import { EventEmitter } from "node:events";

export type ConversationEventType =
  | "presence"
  | "message.created"
  | "assignment.changed"
  | "warehouse.result";

export interface ConversationRealtimeEvent {
  id: number;
  type: ConversationEventType;
  conversationId: number;
  data: unknown;
  at: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let sequence = 0;

export function publishConversationEvent(
  type: ConversationEventType, conversationId: number, data: unknown,
): ConversationRealtimeEvent {
  const event = { id: ++sequence, type, conversationId, data, at: new Date().toISOString() };
  emitter.emit("event", event);
  return event;
}

export function onConversationEvent(listener: (event: ConversationRealtimeEvent) => void): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}

/* ── Obecność i UCHWYT rozmowy (0.158.0) ─────────────────────────────────────
   Decyzja właściciela: samo wejście agenta w pytanie ma przydzielić mu je
   NA CZAS SIEDZENIA, a odpowiedź — na stałe. To jest dokładnie ten kształt,
   który przewidział §6.3 projektu: „Obecność i »pisze« nie są tabelą. To stan
   krótkotrwały, żyjący w pamięci procesu i wygasający sam. Zapisany do bazy
   stałby się trwałym statusem rozmowy, czyli dokładnie tym, czym nie jest —
   a po restarcie serwera kłamałby o tym, kto siedzi przy sprawie."

   Uchwyt NIE TRAFIA DO SQLITE i to jest cała jego istota. Dzięki temu wejście
   na ekran niczego nie mutuje („zero zapisu przy patrzeniu"), a po restarcie
   usługi żadna rozmowa nie zostaje zablokowana przez agenta, który wyszedł
   z pracy w czwartek.

   TRZYMA PIERWSZY, KTÓRY WSZEDŁ. Nie ostatni: inaczej kolega otwierający
   rozmowę „na chwilę" odbierałby ją komuś w połowie pisania odpowiedzi.    */

/** Bez znaku życia uchwyt puszcza. Panel odświeża go co ~15 s. */
const UCHWYT_TTL_MS = 45_000;
/** „Pisze" gaśnie szybciej niż obecność — to sygnał chwilowy. */
const TYPING_TTL_MS = 12_000;

interface Obecny {
  conversationId: number;
  userId: number;
  name: string;
  /** Od kiedy siedzi — po tym rozstrzyga się, kto trzyma uchwyt. */
  od: number;
  wygasa: number;
  pisząDo: number;
}

const obecni = new Map<string, Obecny>();
const klucz = (conversationId: number, userId: number) => `${conversationId}:${userId}`;

function odsiej(teraz = Date.now()) {
  for (const [k, v] of obecni) if (v.wygasa <= teraz) obecni.delete(k);
}

const naZewnatrz = (o: Obecny, teraz: number) => ({
  userId: o.userId, name: o.name, typing: o.pisząDo > teraz,
});

/**
 * Wejście agenta do rozmowy albo znak życia.
 *
 * Wołane też przy odświeżeniu uchwytu, więc musi być tanie i idempotentne.
 * Zdarzenie do panelu leci TYLKO przy pierwszym wejściu — bicie serca co
 * piętnaście sekund zalewałoby szynę zdarzeń bez żadnej nowej informacji.
 */
export function wejdzDoRozmowy(
  conversationId: number, userId: number, name: string, teraz = Date.now(),
) {
  odsiej(teraz);
  const k = klucz(conversationId, userId);
  const byl = obecni.get(k);
  obecni.set(k, {
    conversationId, userId, name,
    od: byl?.od ?? teraz,
    wygasa: teraz + UCHWYT_TTL_MS,
    pisząDo: byl?.pisząDo ?? 0,
  });
  if (!byl) rozglos(conversationId, teraz);
  return trzymajacy(conversationId, teraz);
}

/** Wyjście z rozmowy. Uchwyt puszcza NATYCHMIAST, nie po TTL. */
export function wyjdzZRozmowy(conversationId: number, userId: number, teraz = Date.now()) {
  const bylo = obecni.delete(klucz(conversationId, userId));
  if (bylo) rozglos(conversationId, teraz);
  return trzymajacy(conversationId, teraz);
}

/** Kto siedzi przy rozmowie — po odsianiu tych, którzy przestali dawać znak. */
export function przyRozmowie(conversationId: number, teraz = Date.now()) {
  odsiej(teraz);
  return [...obecni.values()]
    .filter((o) => o.conversationId === conversationId)
    .sort((a, b) => a.od - b.od)
    .map((o) => naZewnatrz(o, teraz));
}

/**
 * Agent trzymający rozmowę: pierwszy, który wszedł i wciąż tam jest.
 *
 * To jest przydział TYMCZASOWY — trwa do wyjścia albo do wygaśnięcia. Trwały
 * przydział robi dopiero odpowiedź (`wysylka.ts`), tak jak chce właściciel.
 */
export function trzymajacy(conversationId: number, teraz = Date.now()):
  { userId: number; name: string } | null {
  odsiej(teraz);
  let pierwszy: Obecny | null = null;
  for (const o of obecni.values()) {
    if (o.conversationId !== conversationId) continue;
    if (!pierwszy || o.od < pierwszy.od) pierwszy = o;
  }
  return pierwszy ? { userId: pierwszy.userId, name: pierwszy.name } : null;
}

/**
 * Uchwyty wszystkich rozmów naraz — dla listy w skrzynce.
 *
 * Lista czyta bazę, a uchwyt żyje w pamięci; złączenie robi się TU, przy
 * odczycie. Dwa zapytania po jednym na wiersz byłyby tańsze w kodzie
 * i droższe przy każdym odświeżeniu kolejki.
 */
export function uchwyty(teraz = Date.now()): Map<number, { userId: number; name: string }> {
  odsiej(teraz);
  const wynik = new Map<number, Obecny>();
  for (const o of obecni.values()) {
    const jest = wynik.get(o.conversationId);
    if (!jest || o.od < jest.od) wynik.set(o.conversationId, o);
  }
  return new Map([...wynik].map(([id, o]) => [id, { userId: o.userId, name: o.name }]));
}

function rozglos(conversationId: number, teraz: number) {
  publishConversationEvent("presence", conversationId, {
    obecni: przyRozmowie(conversationId, teraz),
    trzymajacy: trzymajacy(conversationId, teraz),
  });
}

/** „Pisze" wygasa samo i nigdy nie trafia do SQLite. */
export function setTyping(conversationId: number, userId: number, name: string, active: boolean,
  teraz = Date.now()) {
  /* Pisanie ZNACZY obecność: agent stukający w klawiaturę siedzi przy
     rozmowie, choćby jego bicie serca właśnie się spóźniło. */
  wejdzDoRozmowy(conversationId, userId, name, teraz);
  const o = obecni.get(klucz(conversationId, userId))!;
  o.pisząDo = active ? teraz + TYPING_TTL_MS : 0;
  return publishConversationEvent("presence", conversationId, {
    obecni: przyRozmowie(conversationId, teraz),
    trzymajacy: trzymajacy(conversationId, teraz),
    userId, name, typing: active,
    expiresAt: active ? new Date(teraz + TYPING_TTL_MS).toISOString() : null,
  });
}

export function typingPresence(conversationId: number, teraz = Date.now()) {
  return przyRozmowie(conversationId, teraz).filter((o) => o.typing);
}

/** Wyłącznie dla testów: stan w pamięci nie ma jak wygasnąć między nimi. */
export function _wyczyscObecnosc() {
  obecni.clear();
}
