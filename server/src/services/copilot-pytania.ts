import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { logEvent } from "./events.js";
import { zostalyDaneOsobowe, type TrescBezpieczna } from "./copilot-maskowanie.js";
import type { Tokeny } from "./copilot-koszt.js";
import {
  dopiszLinkiOfert, kontekstSzkicu, ocenTwierdzenia, szkicCopilota,
  type FaktyBezpieczne, type Twierdzenie, type TwierdzenieSurowe,
} from "./copilot-szkic.js";
import { ofertyPoSygnaturze } from "./allegro-oferty-po-sygnaturze.js";
import { przygotujZdjeciaRozmowy, spisZdjec, type Pobieracz, type ZdjecieZBramki } from "./copilot-zdjecia.js";

/* ── Dopytanie Copilota (§14.6, 0.332.0) ─────────────────────────────────────
   Właściciel: „dodaj możliwość kontynuowania rozmowy z modelem, możliwość
   dopytania, rozwiania wątpliwości".

   ── ODPOWIEDŹ JEST DLA AGENTA I NIE MA STĄD DROGI DO KLIENTA ─────────────
   To jest cała architektura tego modułu i jedyna rzecz, którą trzeba tu
   zrozumieć. Szkic ma swoje sita: numer spoza faktów wywraca go, fakt spoza
   listy wywraca go, dane osobowe wywracają go. Te sita stoją tam, bo tamten
   tekst IDZIE DO KLIENTA.

   Odpowiedź na dopytanie nie idzie nigdzie. Czyta ją agent, tak samo jak
   `zastrzezenia` i okno „Skąd to wiem". Gdyby przepuścić ją przez sita
   szkicu, model nie mógłby odpowiedzieć „numeru 17211-ZL8-023 nie mamy
   w kartotece" — bo ten numer nie stoi w faktach. Zdanie, którego agent
   najbardziej potrzebuje, wywracałoby własną odpowiedź.

   Co zostaje z dyscypliny: `twierdzenia` w tym samym kształcie co przy
   szkicu, z tym samym sufitem pewności na źródło. Agent widzi, na czym stoi
   każde zdanie, także wtedy gdy stoi na niczym.

   Żeby cokolwiek z tej wymiany trafiło do klienta, agent układa szkic OD
   NOWA — a wtedy wymiana jest częścią materiału i szkic przechodzi przez
   wszystkie swoje sita. Jedna droga do klienta, ta sama co była.

   ── HAMULEC ──────────────────────────────────────────────────────────────
   Jeden: sufit pytań na rozmowę. Reszty nie ma i to jest ten sam rachunek,
   co przy szkicu na kliknięcie — agent prosi o pracę dla siebie i płaci za
   jedno pytanie. Takt tego nie rusza; automat nie dopytuje.               */

/** Ile wymian na jedną rozmowę. Nie hamulec na wydatek, tylko na pętlę. */
export const SUFIT_PYTAN = 20;

/** Ile znaków może mieć pytanie. Dłuższe to już nie pytanie, tylko szkic. */
export const LIMIT_PYTANIA = 600;

/** Ile wymian wchodzi do kontekstu następnej. Starsze i tak nie ważą. */
export const HISTORII_W_KONTEKSCIE = 6;

export interface WymianaCopilota {
  id: number;
  pytanie: string;
  odpowiedz: string;
  twierdzenia: Twierdzenie[];
  model: string;
  at: string;
  przez: string;
}

export interface OdpowiedzNaPytanie {
  tresc: string;
  twierdzenia: TwierdzenieSurowe[];
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

/** Materiał, na którym model odpowiada. Wszystko przeszło przez maskowanie. */
export interface KontekstPytania {
  watek: TrescBezpieczna;
  fakty: FaktyBezpieczne;
  zdjecia: ZdjecieZBramki[];
  /** Aktualny szkic albo `null` — model ma wiedzieć, o czym agent wątpi. */
  szkic: string | null;
  /** Poprzednie wymiany, od najstarszej. */
  historia: Array<{ pytanie: string; odpowiedz: string }>;
  pytanie: string;
}

export type NadawcaPytania = (k: KontekstPytania) => Promise<OdpowiedzNaPytanie>;

/** Wymiany rozmowy, od najstarszej. Czysty ODCZYT. */
export function wymianyRozmowy(
  conversationId: number, database: DatabaseSync = db(),
): WymianaCopilota[] {
  return (database.prepare(
    `SELECT id, pytanie, odpowiedz, twierdzenia, model, at, przez
       FROM copilot_pytanie WHERE conversation_id=? ORDER BY id`)
    .all(conversationId) as Array<Record<string, unknown>>)
    .map((w) => ({
      id: Number(w.id),
      pytanie: String(w.pytanie),
      odpowiedz: String(w.odpowiedz),
      twierdzenia: JSON.parse(String(w.twierdzenia ?? "[]")) as Twierdzenie[],
      model: String(w.model),
      at: String(w.at),
      przez: String(w.przez),
    }));
}

/**
 * Dopytanie: pytanie agenta → model → zapis wymiany.
 *
 * Fakty zbiera ten sam `kontekstSzkicu`, co szkic, i to jest decyzja, nie
 * oszczędność: dopytanie o szkic, które widzi INNY materiał niż szkic, jest
 * dopytaniem o coś innego. Agent pyta „skąd wiesz" i musi dostać odpowiedź
 * z tego samego zbioru.
 *
 * ZAPIS WYMIANY DOPIERO PO ODPOWIEDZI. Nieudane wywołanie nie zostawia
 * wiersza — zostawia ślad w księdze, tam gdzie liczy się koszt. Pytanie
 * wpisane w pole zostaje w panelu, więc agent nie traci tekstu.
 */
export async function zadajPytanie(
  conversationId: number, pytanie: string, kto: { id: number | null; name: string },
  nadaj: NadawcaPytania, subiekt: SubiektAdapter, teraz = new Date(),
  pobierzZdjecie?: Pobieracz,
): Promise<WymianaCopilota> {
  const tresc = String(pytanie ?? "").trim();
  if (!tresc) throw new Error("Puste pytanie — nie ma o co pytać");
  if (tresc.length > LIMIT_PYTANIA) {
    throw new Error(`Pytanie ma ${tresc.length} znaków, a mieści się ${LIMIT_PYTANIA}. `
      + "Dłuższe to już nie pytanie, tylko szkic — rozbij je na dwa.");
  }

  const dotad = wymianyRozmowy(conversationId);
  if (dotad.length >= SUFIT_PYTAN) {
    throw new Error(`Ta rozmowa ma już ${SUFIT_PYTAN} dopytań. `
      + "Jeśli sprawa dalej nie jest jasna, fakty jej nie rozstrzygną — zapytaj klienta.");
  }

  const surowy = kontekstSzkicu(conversationId, subiekt);
  const kontekst = dopiszLinkiOfert(surowy, await ofertyPoSygnaturze(
    [...surowy.kartoteki.values()].map((x) => x.symbol)));

  /* Zdjęcia tą samą bramką co przy szkicu (0.330.0). Dopytanie „co dokładnie
     widać na tabliczce" bez zdjęcia byłoby pytaniem o nic. */
  const zdjecia = await przygotujZdjeciaRozmowy(db(), conversationId, pobierzZdjecie);
  const spis = spisZdjec(zdjecia);
  const fakty = (spis ? `${kontekst.tekstFaktow}\n\n${spis}` : kontekst.tekstFaktow) as FaktyBezpieczne;

  /* Asercja przed siecią, tak samo jak przy szkicu: wątek niesie tekst
     klienta i to on ma być czysty. PYTANIE AGENTA NIE PRZECHODZI przez
     maskowanie — pisze je pracownik biura o naszym towarze, nie klient
     o sobie, a wycinanie z niego numerów zabrałoby mu sens. */
  if (zostalyDaneOsobowe(String(kontekst.watek))) {
    throw new Error("Maskowanie nie oczyściło rozmowy — nic nie wyszło do dostawcy");
  }

  const szkic = szkicCopilota(conversationId);
  let odp: OdpowiedzNaPytanie;
  try {
    odp = await nadaj({
      watek: kontekst.watek, fakty, zdjecia: zdjecia.zdjecia,
      szkic: szkic ? szkic.tresc : null,
      historia: dotad.slice(-HISTORII_W_KONTEKSCIE)
        .map((w) => ({ pytanie: w.pytanie, odpowiedz: w.odpowiedz })),
      pytanie: tresc,
    });
  } catch (e) {
    zapiszWywolanie(conversationId, null, "blad",
      (e as { slad?: string }).slad || (e as Error).message, kto, teraz);
    throw e;
  }

  const twierdzenia = ocenTwierdzenia(odp.twierdzenia);
  const id = Number(db().prepare(`INSERT INTO copilot_pytanie
    (conversation_id,pytanie,odpowiedz,twierdzenia,model,at,przez,przez_user_id)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(conversationId, tresc, odp.tresc, JSON.stringify(twierdzenia), odp.model,
      teraz.toISOString(), kto.name, kto.id).lastInsertRowid);
  zapiszWywolanie(conversationId, odp, "ok", null, kto, teraz);

  /* Ładunek niesie DŁUGOŚCI, nigdy treści (§19): pytanie agenta bywa
     o konkretnym kliencie, a `events` nie ma retencji. */
  logEvent("copilot_pytanie", kto.name, null, {
    conversationId, znakowPytania: tresc.length, znakowOdpowiedzi: odp.tresc.length,
    wymiana: dotad.length + 1, model: odp.model, tokeny: odp.zuzycie,
    /* Zdjęcia liczbami, jak przy szkicu — patrz blizna 0.484.6 w `copilot-zdjecia`. */
    zdjec: zdjecia.zdjecia.length, zdjecBledow: zdjecia.bledow,
  }, kto.id);

  return wymianyRozmowy(conversationId).find((w) => w.id === id)!;
}

function zapiszWywolanie(
  conversationId: number, odp: OdpowiedzNaPytanie | null, wynik: "ok" | "blad",
  blad: string | null, kto: { id: number | null }, teraz: Date,
): void {
  db().prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at)
    VALUES ('pytanie',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(conversationId, odp?.model ?? "", odp?.zuzycie.wej ?? 0, odp?.zuzycie.wyj ?? 0,
      odp?.zuzycie.cacheZapis ?? 0, odp?.zuzycie.cacheOdczyt ?? 0, odp?.ms ?? 0, wynik,
      blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString());
}
