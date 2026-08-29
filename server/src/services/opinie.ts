import { db, nowIso } from "../db/db.js";
import { allegroAdapter } from "../adapters/allegro.js";
import { logEvent } from "./events.js";
import { przebudujSprawy } from "./sprawa.js";
import { dopiszZdarzenie } from "./os-sprawy.js";

/* ── Opinie o sprzedawcy — piąte źródło sprawy (0.135.0) ─────────────────────
   Etap E4 z docs/architektura-spraw.md. Opinia z jedną gwiazdką to sprawa
   klienta jak każda inna, tylko widoczna publicznie — a do tej wersji nie było
   jej w aplikacji wcale: agent dowiadywał się o niej z panelu Allegro albo od
   właściciela, zwykle po fakcie.

   Rejestr jest CIENKI z premedytacją: opinia nie ma u nas mechaniki (koszy,
   korekt, werdyktów), ma tylko trzy stany i prowadzącego. Cała jej wartość
   bierze się ze sklejenia w sprawę — zła opinia siada przy zwrocie tego
   samego zamówienia i widać ją tam, gdzie stoi robota.

   ODPOWIADANIE PRZEZ API czeka na weryfikację końcówki (patrz OpiniaAllegro):
   pisanie do klienta przez niezweryfikowany zasób to jedyny rodzaj błędu,
   którego nie da się cofnąć. Do tego czasu odpowiada się w panelu Allegro,
   a status w rejestrze mówi, że sprawa jest załatwiona.                     */

export const STATUSY_OPINII = ["nowa", "przejrzana", "zalatwiona"] as const;
export type StatusOpinii = (typeof STATUSY_OPINII)[number];

/** Ile dni wstecz schodzi pobranie przy pierwszym uruchomieniu. */
const DNI_PIERWSZEGO_POBRANIA = 90;

/** Awaria pracy z opinią; `kod` niesie status HTTP dla trasy. */
export class BladOpinii extends Error {
  constructor(
    message: string,
    readonly kod = 400
  ) {
    super(message);
    this.name = "BladOpinii";
  }
}

export interface Opinia {
  id: number;
  allegroId: string;
  orderId: string | null;
  kupujacyLogin: string | null;
  ocena: number | null;
  rekomendacja: string | null;
  tresc: string | null;
  status: StatusOpinii;
  odpowiedz: string | null;
  mozliwaOdpowiedz: boolean;
  prowadzi: string | null;
  utworzonoAllegro: string | null;
}

const wiersz = (w: Record<string, unknown>): Opinia => ({
  id: w.id as number,
  allegroId: w.allegro_id as string,
  orderId: (w.order_id as string | null) ?? null,
  kupujacyLogin: (w.kupujacy_login as string | null) ?? null,
  ocena: (w.ocena as number | null) ?? null,
  rekomendacja: (w.rekomendacja as string | null) ?? null,
  tresc: (w.tresc as string | null) ?? null,
  status: w.status as StatusOpinii,
  odpowiedz: (w.odpowiedz as string | null) ?? null,
  mozliwaOdpowiedz: (w.mozliwa_odpowiedz as number) === 1,
  prowadzi: (w.prowadzi as string | null) ?? null,
  utworzonoAllegro: (w.utworzono_allegro as string | null) ?? null,
});

export function listaOpinii(status?: string, limit = 200): Opinia[] {
  const gdzie = status ? "WHERE status = ?" : "";
  const wiersze = db()
    .prepare(
      `SELECT * FROM opinia ${gdzie}
        ORDER BY utworzono_allegro IS NULL, utworzono_allegro DESC, id DESC LIMIT ?`
    )
    .all(...(status ? [status, limit] : [limit])) as Array<Record<string, unknown>>;
  return wiersze.map(wiersz);
}

export function opinia(id: number): Opinia {
  const w = db().prepare("SELECT * FROM opinia WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!w) throw new BladOpinii("Nie ma takiej opinii", 404);
  return wiersz(w);
}

/** Ile opinii czeka — pigułka przy zakładce (wzorzec licznikDyskusji). */
export function licznikOpinii(): { nowe: number; zle: number } {
  const d = db();
  const nowe = (
    d.prepare("SELECT COUNT(*) AS n FROM opinia WHERE status = 'nowa'").get() as { n: number }
  ).n;
  /* „Złe" liczymy po REKOMENDACJI, nie po gwiazdkach: rekomendację Allegro
     podaje zawsze, a ocenę bywa że nie. Trójka bez rekomendacji nie jest
     zła — jest bez zdania. */
  const zle = (
    d
      .prepare(
        `SELECT COUNT(*) AS n FROM opinia
          WHERE status <> 'zalatwiona' AND (rekomendacja = 'NEGATIVE' OR ocena <= 2)`
      )
      .get() as { n: number }
  ).n;
  return { nowe, zle };
}

export interface WynikSynchronizacjiOpinii {
  nowych: number;
  przejrzanych: number;
}

let stanSynchronizacji: (WynikSynchronizacjiOpinii & { at: string; przez: string }) | null = null;

export function stanSynchronizacjiOpinii() {
  return stanSynchronizacji;
}

/** Od kiedy schodzi pobranie: najświeższa znana opinia albo kwartał wstecz. */
function odKiedy(): string {
  const w = db().prepare("SELECT MAX(utworzono_allegro) AS max FROM opinia").get() as {
    max: string | null;
  };
  return (
    w.max ?? new Date(Date.now() - DNI_PIERWSZEGO_POBRANIA * 86_400_000).toISOString()
  );
}

/**
 * Jeden przebieg synchronizacji opinii. Idempotentny: upsert po kluczu
 * Allegro, a nasz `status` i `prowadzi` są NASZE i żaden przebieg ich nie
 * cofa (ta sama zasada co przy dyskusjach).
 */
export async function synchronizujOpinie(autor: string): Promise<WynikSynchronizacjiOpinii> {
  const opinie = await allegroAdapter().listaOpinii(odKiedy());
  const d = db();
  const teraz = nowIso();
  const upsert = d.prepare(
    `INSERT INTO opinia (allegro_id, order_id, kupujacy_login, ocena, rekomendacja, tresc,
                         odpowiedz, mozliwa_odpowiedz, utworzono_allegro, widziano_at, utworzono_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(allegro_id) DO UPDATE SET
       order_id = excluded.order_id,
       kupujacy_login = excluded.kupujacy_login,
       ocena = excluded.ocena,
       rekomendacja = excluded.rekomendacja,
       tresc = excluded.tresc,
       odpowiedz = excluded.odpowiedz,
       mozliwa_odpowiedz = excluded.mozliwa_odpowiedz,
       widziano_at = excluded.widziano_at`
  );
  const istnieje = d.prepare("SELECT id FROM opinia WHERE allegro_id = ?");

  let nowych = 0;
  for (const o of opinie) {
    if (!o.id) continue;
    const znana = istnieje.get(o.id) !== undefined;
    upsert.run(
      o.id,
      o.orderId,
      o.kupujacyLogin,
      o.ocena,
      o.rekomendacja,
      o.tresc,
      o.odpowiedz,
      o.mozliwaOdpowiedz ? 1 : 0,
      o.utworzono,
      teraz,
      teraz
    );
    if (znana) continue;
    nowych++;
    const nowa = istnieje.get(o.id) as { id: number } | undefined;
    if (nowa) {
      dopiszZdarzenie({
        rodzaj: "opinia",
        lokalnyId: nowa.id,
        typ: "zalozona",
        kto: "klient",
        /* Gwiazdki w szczególe zdarzenia: oś czasu ma powiedzieć, czy klient
           pochwalił, czy zjechał — bez wchodzenia w rejestr. */
        szczegol: o.ocena !== null ? `${o.ocena}/5` : (o.rekomendacja ?? null),
        kiedy: o.utworzono ?? teraz,
      });
    }
  }
  if (nowych > 0) logEvent("opinia_sync", autor, null, { nowych, przejrzanych: opinie.length });
  stanSynchronizacji = { at: teraz, przez: autor, nowych, przejrzanych: opinie.length };
  /* Rejestr się zmienił — nakładka spraw dogania (0.128.0). */
  przebudujSprawy();
  return { nowych, przejrzanych: opinie.length };
}

export function zmienStatusOpinii(id: number, status: string, autor: string): Opinia {
  if (!(STATUSY_OPINII as readonly string[]).includes(status)) {
    throw new BladOpinii(`Nieznany status „${status}” — dozwolone: ${STATUSY_OPINII.join(", ")}`);
  }
  const o = opinia(id);
  if (o.status === status) throw new BladOpinii(`Opinia jest już w statusie „${status}”`, 409);
  db()
    .prepare("UPDATE opinia SET status = ?, prowadzi = ?, prowadzi_at = datetime('now') WHERE id = ?")
    .run(status, autor, id);
  logEvent(`opinia_${status}`, autor, null, { opiniaId: id, poprzedni: o.status });
  dopiszZdarzenie({
    rodzaj: "opinia",
    lokalnyId: id,
    typ: status === "zalatwiona" ? "zamknieta" : "status",
    kto: "my",
    autor,
    szczegol: status,
    wariant: status,
  });
  przebudujSprawy();
  return opinia(id);
}

/** Stempel „prowadzę" — znacznik, nie blokada (wzorzec pozostałych rejestrów). */
export function stempelProwadziOpinii(id: number, autor: string): void {
  opinia(id); // 404, zanim cokolwiek zapiszemy
  db()
    .prepare("UPDATE opinia SET prowadzi = ?, prowadzi_at = datetime('now') WHERE id = ?")
    .run(autor, id);
  dopiszZdarzenie({
    rodzaj: "opinia",
    lokalnyId: id,
    typ: "przejeto",
    kto: "my",
    autor,
    wariant: autor,
  });
  przebudujSprawy();
}
