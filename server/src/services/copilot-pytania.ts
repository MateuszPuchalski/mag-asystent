import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { config } from "../config.js";
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
import {
  naPropozycjiNiepewne, zestawNarzedzi, type UzycieNarzedzia, type ZestawNarzedzi,
} from "./copilot-narzedzia.js";
import {
  bezOgona, czemuNiegotowy, dowodZeZnaleziska, numerySitaKartoteki, sprawdzZnalezisko, SUFIT_ZNALEZISK,
  type WynikSieci, type ZnaleziskoSurowe,
} from "./pasowanie-z-sieci.js";
import { tekstyPdf } from "./pdf-tekst.js";
import { warunekZeStrony } from "./zrodla-sieci.js";
import { zaproponujZastosowanie } from "./wiedza.js";

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
  /** Po co model sięgnął do bazy, w kolejności wywołań. Pusta = nie sięgał. */
  narzedzia: UzycieNarzedzia[];
  /** Pasowania z sieci, które przeszły sito (@wydanie). Pusta = sieci nie było albo nic nie przeszło. */
  pasowania: PasowanieZDopytania[];
}

/* ── Pasowanie z sieci w dopytaniu (@wydanie) ───────────────────────────────
   Metoda SZPERACZA — paczki, której biuro używało w czacie obok panelu —
   przeniesiona tutaj. Tam wynik zostawał w czacie; tu staje przy wymianie
   i jednym kliknięciem („Zapisz jako propozycję”) idzie do Kolejki Wiedzy.

   SITO TO SAMO CO W NOCY (`sprawdzZnalezisko`): cytat dosłownie na
   przeczytanej stronie, model w cytacie, marka na stronie, NASZ numer
   na stronie. Odpowiedź dla agenta nie przechodzi przez sita szkicu —
   ale pasowanie z niej idzie do bazy wiedzy, a tam wolno wejść tylko
   temu, co da się sprawdzić bez modelu.

   Zapis bierze parę z WIERSZA wymiany, nie z ciała żądania — ta sama zasada
   co przy pasowaniu ze szkicu. Panel nie ma jak podać cudzej pary. */

/** Pasowanie tak, jak oddał je model. */
export type PasowanieModelu = Omit<ZnaleziskoSurowe, "rokOd" | "rokDo" | "seryjnyOd" | "seryjnyDo"> & { symbol: string };

export interface PasowanieZDopytania extends PasowanieModelu {
  twId: number;
  /** Ukryty warunek ze strony („will not fit manual”) — idzie do warunków propozycji. */
  warunek: string | null;
  /** Los po kliknięciu: `nowa` — stanęła w Kolejce, `juz_byla` — ta para już tam jest. */
  zapis: "nowa" | "juz_byla" | null;
}

/**
 * Sito pasowań z dopytania. Czyste poza ODCZYTEM kartoteki i jej numerów.
 * Kartoteka po symbolu, bo model zna nasze symbole z faktów i narzędzi,
 * a nie nasze identyfikatory. Bez numerów OEM kartoteki nie ma czym
 * sprawdzić strony — wtedy pasowanie odpada, jak w nocy.
 */
export function pasowaniaPoSicie(
  lista: PasowanieModelu[], strony: WynikSieci["strony"], database: DatabaseSync = db(),
): PasowanieZDopytania[] {
  const wynik: PasowanieZDopytania[] = [];
  const bylo = new Set<string>();
  for (const p of lista.slice(0, SUFIT_ZNALEZISK)) {
    const t = database.prepare("SELECT tw_id, symbol FROM sgt_towar WHERE symbol=?").get(p.symbol.trim()) as
      { tw_id: number; symbol: string } | undefined;
    if (!t) continue;
    const z: ZnaleziskoSurowe = { ...p, rokOd: null, rokDo: null, seryjnyOd: null, seryjnyDo: null };
    if (sprawdzZnalezisko(z, strony, numerySitaKartoteki(Number(t.tw_id), database))) continue;
    /* Ta sama para z dwóch stron to jeden przycisk, nie dwa. */
    const klucz = `${t.tw_id}|${p.marka.trim().toLowerCase()}|${p.model.trim().toLowerCase()}`;
    if (bylo.has(klucz)) continue;
    bylo.add(klucz);
    const strona = strony.find((s) => bezOgona(s.url) === bezOgona(p.url));
    wynik.push({
      ...p, symbol: t.symbol, twId: Number(t.tw_id),
      warunek: strona ? warunekZeStrony(strona.tekst, p.cytat) : null, zapis: null,
    });
  }
  return wynik;
}

/**
 * „Zapisz jako propozycję” — jedno kliknięcie agenta. Propozycja ma źródło
 * `copilot` i podpis KLIKAJĄCEGO, bo to on uznał stronę za wartą Kolejki.
 * Zatwierdza dalej człowiek w Wiedzy, jak każdą propozycję.
 */
export function zapiszPasowanieZDopytania(
  pytanieId: number, nr: number, kto: { id: number | null; name: string }, database: DatabaseSync = db(),
): WymianaCopilota {
  if (kto.id == null) throw new Error("Zapis propozycji wymaga konta biura");
  const w = database.prepare("SELECT conversation_id, pasowania FROM copilot_pytanie WHERE id=?").get(pytanieId) as
    { conversation_id: number; pasowania: string } | undefined;
  if (!w) throw new Error("Nie ma takiej wymiany");
  const lista = JSON.parse(String(w.pasowania ?? "[]")) as PasowanieZDopytania[];
  const p = lista[nr];
  if (!p) throw new Error("Nie ma takiego pasowania w tej wymianie");
  /* Drugie kliknięcie niczego nie dokłada — przycisk po pierwszym i tak znika. */
  if (!p.zapis) {
    const z = zaproponujZastosowanie({
      twId: p.twId,
      model: { rodzaj: p.rodzaj, marka: p.marka.trim(), nazwa: p.model.trim(), wariant: p.wariant?.trim() || null },
      warunki: { rokOd: null, rokDo: null, seryjnyOd: null, seryjnyDo: null, warunek: p.warunek },
      polaryzacja: "pasuje",
      zrodlo: "copilot",
      komentarz: "Copilot znalazł to w sieci przy dopytaniu. Sprawdź stronę przed zatwierdzeniem.",
      dowod: dowodZeZnaleziska(p),
    }, { userId: kto.id, name: kto.name }, database);
    lista[nr] = { ...p, zapis: z ? "nowa" : "juz_byla" };
    database.prepare("UPDATE copilot_pytanie SET pasowania=? WHERE id=?").run(JSON.stringify(lista), pytanieId);
    logEvent("copilot_pasowanie_z_sieci", kto.name, null,
      { pytanieId, twId: p.twId, zapis: lista[nr]!.zapis }, kto.id, database);
  }
  return wymianyRozmowy(Number(w.conversation_id), database).find((x) => x.id === pytanieId)!;
}

export interface OdpowiedzNaPytanie {
  tresc: string;
  twierdzenia: TwierdzenieSurowe[];
  /** Pasowania z przeczytanych stron (@wydanie), PRZED sitem. Brak = bez sieci. */
  pasowania?: PasowanieModelu[];
  /** Strony i PDF-y przeczytane przez `web_fetch` — materiał sita. */
  strony?: WynikSieci["strony"];
  pdfy?: WynikSieci["pdfy"];
  model: string;
  /** Suma ze WSZYSTKICH rund narzędzi — tyle kosztowało jedno dopytanie. */
  zuzycie: Tokeny;
  ms: number;
  narzedzia: UzycieNarzedzia[];
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
  /** Odczyt naszej bazy na żądanie modelu (0.507.0). `null` = bez narzędzi. */
  narzedzia: ZestawNarzedzi | null;
  /** Czy model dostaje wyszukiwarkę i czytnik stron (@wydanie). */
  siec?: boolean;
}

export type NadawcaPytania = (k: KontekstPytania) => Promise<OdpowiedzNaPytanie>;

/** Wymiany rozmowy, od najstarszej. Czysty ODCZYT. */
export function wymianyRozmowy(
  conversationId: number, database: DatabaseSync = db(),
): WymianaCopilota[] {
  return (database.prepare(
    `SELECT id, pytanie, odpowiedz, twierdzenia, model, at, przez, narzedzia, pasowania
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
      narzedzia: JSON.parse(String(w.narzedzia ?? "[]")) as UzycieNarzedzia[],
      pasowania: JSON.parse(String(w.pasowania ?? "[]")) as PasowanieZDopytania[],
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
      /* Narzędzia czytają tę samą bazę co fakty, ale na żądanie modelu.
         Tylko odczyt i tylko nasz towar — granica stoi w `copilot-narzedzia`. */
      narzedzia: zestawNarzedzi(subiekt),
      /* Jeden wyłącznik na czytanie cudzych stron: ten sam co przebieg nocny. */
      siec: czemuNiegotowy() === null,
    });
  } catch (e) {
    zapiszWywolanie(conversationId, null, "blad",
      (e as { slad?: string }).slad || (e as Error).message, kto, teraz,
      (e as { zuzycie?: Tokeny }).zuzycie);
    throw e;
  }

  /* Strony przeczytane w sieci (@wydanie): PDF-y zamieniamy na tekst tu, jak
     w nocy. Twierdzenie ze źródłem `siec` bez ANI JEDNEJ przeczytanej strony
     to wiedza modelu przebrana za stronę — schodzi do `model`, bo sufit
     pewności stoi w kodzie, nie w dyscyplinie modelu. */
  const przeczytane = [...(odp.strony ?? []), ...await tekstyPdf(odp.pdfy ?? [])];
  const surowe = odp.twierdzenia.map((t) => (t.zrodlo === "siec" && przeczytane.length === 0
    ? { ...t, zrodlo: "model" as const } : t));
  const pasowania = pasowaniaPoSicie(odp.pasowania ?? [], przeczytane);

  /* Dwa sufity po kolei: źródło twierdzenia, potem propozycja z bazy wiedzy. */
  const twierdzenia = naPropozycjiNiepewne(ocenTwierdzenia(surowe));
  const id = Number(db().prepare(`INSERT INTO copilot_pytanie
    (conversation_id,pytanie,odpowiedz,twierdzenia,model,at,przez,przez_user_id,narzedzia,pasowania)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(conversationId, tresc, odp.tresc, JSON.stringify(twierdzenia), odp.model,
      teraz.toISOString(), kto.name, kto.id, JSON.stringify(odp.narzedzia ?? []),
      JSON.stringify(pasowania)).lastInsertRowid);
  zapiszWywolanie(conversationId, odp, "ok", null, kto, teraz);

  /* Ładunek niesie DŁUGOŚCI, nigdy treści (§19): pytanie agenta bywa
     o konkretnym kliencie, a `events` nie ma retencji. */
  logEvent("copilot_pytanie", kto.name, null, {
    conversationId, znakowPytania: tresc.length, znakowOdpowiedzi: odp.tresc.length,
    wymiana: dotad.length + 1, model: odp.model, tokeny: odp.zuzycie,
    /* Zdjęcia liczbami, jak przy szkicu — patrz blizna 0.484.6 w `copilot-zdjecia`. */
    zdjec: zdjecia.zdjecia.length, zdjecBledow: zdjecia.bledow,
    /* Nazwy narzędzi, bez argumentów: argument bywa numerem z rozmowy. */
    narzedzia: (odp.narzedzia ?? []).map((n) => n.nazwa),
    /* Sieć liczbami (@wydanie): ile wyszukań i ile pasowań przeszło sito. */
    wyszukiwan: odp.zuzycie.wyszukiwania ?? 0, stron: przeczytane.length,
    pasowanZSieci: (odp.pasowania ?? []).length, poSicie: pasowania.length,
  }, kto.id);

  return wymianyRozmowy(conversationId).find((w) => w.id === id)!;
}

function zapiszWywolanie(
  conversationId: number, odp: OdpowiedzNaPytanie | null, wynik: "ok" | "blad",
  blad: string | null, kto: { id: number | null }, teraz: Date,
  /* Rundy narzędzi zapłacone przed błędem (0.507.0). Bez nich porażka po
     czterech rundach ważyłaby w pomiarze zero, a kosztowała cztery żądania. */
  zuzyciePrzedBledem?: Tokeny,
): void {
  const t = odp?.zuzycie ?? zuzyciePrzedBledem;
  /* Model pusty przy błędzie bez rund, jak dotąd — pomiar go pomija. Z rundami
     wpisujemy model z konfiguracji, bo inaczej pomiar zgubiłby ich koszt. */
  const model = odp?.model ?? (t && (t.wej || t.wyj) ? config.copilot.model : "");
  db().prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at,wyszukiwania)
    VALUES ('pytanie',?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(conversationId, model, t?.wej ?? 0, t?.wyj ?? 0,
      t?.cacheZapis ?? 0, t?.cacheOdczyt ?? 0, odp?.ms ?? 0, wynik,
      blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString(),
      /* Wyszukiwania dopytania (@wydanie) — płatne osobno, pomiar ma je widzieć. */
      t?.wyszukiwania ?? 0);
}
