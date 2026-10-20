import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { config } from "../config.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { logEvent } from "./events.js";
import {
  zamaskujOdwracalnie, zostalyDaneOsobowe, type MaskaOdwracalna, type TrescBezpieczna,
} from "./copilot-maskowanie.js";
import type { Tokeny } from "./copilot-koszt.js";
import {
  dopiszLinkiOfert, kontekstSzkicu, loginRozmowcy, ocenTwierdzenia, sitaSzkicu, szkicCopilota,
  type Fakt, type FaktyBezpieczne, type KodSita, type SzkicSurowy, type Twierdzenie,
  type TwierdzenieSurowe,
} from "./copilot-szkic.js";
import { ofertyPoSygnaturze } from "./allegro-oferty-po-sygnaturze.js";
import { przygotujZdjeciaRozmowy, spisZdjec, type Pobieracz, type ZdjecieZBramki } from "./copilot-zdjecia.js";
import {
  zestawNarzedzi, type UzycieNarzedzia, type WynikWywolania, type ZestawNarzedzi,
} from "./copilot-narzedzia.js";
import { LIMIT_ZNAKOW } from "./wysylka.js";

/* ── Dopytanie Copilota (§14.6) ──────────────────────────────────────────────
   Właściciel: „dodaj możliwość kontynuowania rozmowy z modelem, możliwość
   dopytania, rozwiania wątpliwości". I decyzja do tego: dopytanie POPRAWIA
   szkic, zamiast mówić agentowi, co ma w nim poprawić.

   ── DWA TEKSTY, DWIE DROGI ───────────────────────────────────────────────
   To jest cała architektura tego modułu. Jedno wywołanie oddaje dwa teksty
   i każdy idzie inną drogą.

   NOTKA DLA AGENTA (`odpowiedz`) nie idzie nigdzie. Czyta ją agent, tak samo
   jak `zastrzezenia` i okno „Skąd to wiem". Gdyby przepuścić ją przez sita
   szkicu, model nie mógłby odpowiedzieć „numeru 17211-ZL8-023 nie mamy
   w kartotece" — bo ten numer nie stoi w faktach. Zdanie, którego agent
   najbardziej potrzebuje, wywracałoby własną odpowiedź. Z dyscypliny zostają
   `twierdzenia` w tym samym kształcie co przy szkicu, z tym samym sufitem
   pewności na źródło.

   NOWA WERSJA SZKICU przechodzi przez WSZYSTKIE sita szkicu, te same co
   szkic na kliknięcie (`sitaSzkicu`), i wraca do pola agenta. Do klienta
   idzie dopiero po „Wyślij", więc jedna droga do klienta zostaje ta sama.
   Wersja odrzucona przez sita nie wywraca wymiany: notka dalej jest
   użyteczna, a agent dostaje zdanie, czemu tekst został bez zmian.

   `szkic_copilota` zostaje NIETKNIĘTY. Na nim stoi automat wysyłki i pomiar
   losu szkicu, a wersja z dopytania jest pracą agenta, nie propozycją modelu.

   ── HAMULEC ──────────────────────────────────────────────────────────────
   Jeden: sufit pytań na rozmowę. Reszty nie ma i to jest ten sam rachunek,
   co przy szkicu na kliknięcie — agent prosi o pracę dla siebie i płaci za
   jedno pytanie. Takt tego nie rusza; automat nie dopytuje.               */

/** Ile wymian na jedną rozmowę. Nie hamulec na wydatek, tylko na pętlę. */
export const SUFIT_PYTAN = 20;

/** Ile znaków może mieć pytanie. Dłuższe to już nie pytanie, tylko szkic. */
export const LIMIT_PYTANIA = 600;

/**
 * Ile znaków może mieć tekst z pola, który model poprawia. Dwa limity Allegro,
 * nie jeden: polecenie „skróć to" ma działać właśnie na szkicu ponad limitem.
 * Sufit stoi, bo cały tekst wraca w odpowiedzi i płacimy za niego dwa razy.
 */
export const SUFIT_POLA = 2 * LIMIT_ZNAKOW;

/** Ile wymian wchodzi do kontekstu następnej. Starsze i tak nie ważą. */
export const HISTORII_W_KONTEKSCIE = 6;

export interface WymianaCopilota {
  id: number;
  pytanie: string;
  /** Odpowiedź na pytanie albo notka, co model zmienił w szkicu. Tylko dla agenta. */
  odpowiedz: string;
  twierdzenia: Twierdzenie[];
  model: string;
  at: string;
  przez: string;
  /** Po co model sięgnął do bazy, w kolejności wywołań. Pusta = nie sięgał. */
  narzedzia: UzycieNarzedzia[];
  /**
   * Tekst, który model poprawiał: pole agenta albo szkic Copilota. Stoi tylko
   * przy próbie poprawki, także odrzuconej; `null` przy czystym pytaniu.
   */
  szkicPrzed: string | null;
  /** Wersja po sitach, z wartościami klienta. `null`: brak, odrzucona albo bez zmian. */
  szkicPo: string | null;
  /** Skąd model wie to, co stoi w nowej wersji. Pusta lista bez wersji. */
  szkicTwierdzenia: Twierdzenie[];
  /** Czego modelowi zabrakło przy wersji. Pusta lista bez wersji. */
  szkicZastrzezenia: string[];
  /** Zdanie dla agenta, czemu sita odrzuciły poprawkę; `null` = nie odrzuciły. */
  szkicOdrzucony: string | null;
}

export interface OdpowiedzNaPytanie {
  tresc: string;
  twierdzenia: TwierdzenieSurowe[];
  model: string;
  /** Suma ze WSZYSTKICH rund narzędzi — tyle kosztowało jedno dopytanie. */
  zuzycie: Tokeny;
  ms: number;
  narzedzia: UzycieNarzedzia[];
  /**
   * Cała nowa wersja szkicu, gdy agent prosił o zmianę; `null` przy czystym
   * pytaniu. Opcjonalne, bo nadawca bez poprawek, jak atrapa, go nie zna.
   */
  szkic?: SzkicSurowy | null;
  /** Wyniki narzędzi z numerami N#: na nich sita sprawdzają odwołania wersji. */
  wynikiNarzedzi?: WynikWywolania[];
}

/** Materiał, na którym model odpowiada. Wszystko przeszło przez maskowanie. */
export interface KontekstPytania {
  watek: TrescBezpieczna;
  fakty: FaktyBezpieczne;
  zdjecia: ZdjecieZBramki[];
  /** Tekst z pola agenta albo szkic Copilota, zamaskowany; `null` = nie ma czego poprawiać. */
  szkic: TrescBezpieczna | null;
  /** Poprzednie wymiany, od najstarszej. */
  historia: Array<{ pytanie: string; odpowiedz: string }>;
  pytanie: string;
  /** Odczyt naszej bazy na żądanie modelu. `null` = bez narzędzi. */
  narzedzia: ZestawNarzedzi | null;
}

export type NadawcaPytania = (k: KontekstPytania) => Promise<OdpowiedzNaPytanie>;

/** Wymiany rozmowy, od najstarszej. Czysty ODCZYT. */
export function wymianyRozmowy(
  conversationId: number, database: DatabaseSync = db(),
): WymianaCopilota[] {
  return (database.prepare(
    `SELECT id, pytanie, odpowiedz, twierdzenia, model, at, przez, narzedzia,
            szkic_przed, szkic_po, szkic_odrzucony, szkic_twierdzenia, szkic_zastrzezenia
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
      szkicPrzed: w.szkic_przed == null ? null : String(w.szkic_przed),
      szkicPo: w.szkic_po == null ? null : String(w.szkic_po),
      szkicTwierdzenia: JSON.parse(String(w.szkic_twierdzenia ?? "[]")) as Twierdzenie[],
      szkicZastrzezenia: JSON.parse(String(w.szkic_zastrzezenia ?? "[]")) as string[],
      szkicOdrzucony: w.szkic_odrzucony == null ? null : String(w.szkic_odrzucony),
    }));
}

/**
 * Dopytanie: pytanie albo polecenie agenta → model → sita wersji → zapis wymiany.
 *
 * Fakty zbiera ten sam `kontekstSzkicu`, co szkic, i to jest decyzja, nie
 * oszczędność: dopytanie o szkic, które widzi INNY materiał niż szkic, jest
 * dopytaniem o coś innego. Agent pyta „skąd wiesz" i musi dostać odpowiedź
 * z tego samego zbioru. Te same fakty dźwigają też sita nowej wersji.
 *
 * `o.szkic` to tekst z pola agenta, z jego ręcznymi zmianami. Puste pole
 * znaczy „poprawiaj szkic Copilota".
 *
 * ZAPIS WYMIANY DOPIERO PO ODPOWIEDZI. Nieudane wywołanie nie zostawia
 * wiersza — zostawia ślad w księdze, tam gdzie liczy się koszt. Pytanie
 * wpisane w pole zostaje w panelu, więc agent nie traci tekstu.
 */
export async function zadajPytanie(
  conversationId: number, pytanie: string, kto: { id: number | null; name: string },
  nadaj: NadawcaPytania, subiekt: SubiektAdapter,
  o: { szkic?: string | null; teraz?: Date; pobierzZdjecie?: Pobieracz } = {},
): Promise<WymianaCopilota> {
  const teraz = o.teraz ?? new Date();
  const tresc = String(pytanie ?? "").trim();
  if (!tresc) throw new Error("Puste pytanie — nie ma o co pytać");
  if (tresc.length > LIMIT_PYTANIA) {
    throw new Error(`Pytanie ma ${tresc.length} znaków, a mieści się ${LIMIT_PYTANIA}. `
      + "Dłuższe to już nie pytanie, tylko szkic — rozbij je na dwa.");
  }
  const zPola = typeof o.szkic === "string" && o.szkic.trim() ? o.szkic : null;
  if (zPola && zPola.length > SUFIT_POLA) {
    throw new Error(`Tekst w polu ma ${zPola.length} znaków, a Copilot poprawia najwyżej ${SUFIT_POLA}. `
      + "Skróć go sam albo wyczyść pole, żeby Copilot pracował na swoim szkicu.");
  }

  const dotad = wymianyRozmowy(conversationId);
  if (dotad.length >= SUFIT_PYTAN) {
    throw new Error(`Ta rozmowa ma już ${SUFIT_PYTAN} dopytań. `
      + "Jeśli sprawa dalej nie jest jasna, fakty jej nie rozstrzygną — zapytaj klienta.");
  }

  const surowy = kontekstSzkicu(conversationId, subiekt);
  const kontekst = dopiszLinkiOfert(surowy, await ofertyPoSygnaturze(
    [...surowy.kartoteki.values()].map((x) => x.symbol)));

  /* Zdjęcia tą samą bramką co przy szkicu. Dopytanie „co dokładnie widać na
     tabliczce" bez zdjęcia byłoby pytaniem o nic. */
  const zdjecia = await przygotujZdjeciaRozmowy(db(), conversationId, o.pobierzZdjecie);
  const spis = spisZdjec(zdjecia);
  const fakty = (spis ? `${kontekst.tekstFaktow}\n\n${spis}` : kontekst.tekstFaktow) as FaktyBezpieczne;

  /* PODSTAWA POPRAWKI: tekst z pola wygrywa ze szkicem Copilota, bo niesie
     ręczne zmiany agenta, a poprawka ma iść od nich, nie od nich wstecz.
     Do dostawcy idzie ZAMASKOWANA, jak nasze wychodzące w wątku: agent
     przepisuje klientowi jego adres i telefon. Maska jest odwracalna, bo
     nowa wersja wraca do pola z wartościami. */
  const baza = zPola ?? (szkicCopilota(conversationId)?.tresc || null);
  const maska = baza ? zamaskujOdwracalnie(baza, loginRozmowcy(conversationId)) : null;

  /* Asercja przed siecią, tak samo jak przy szkicu: wątek i pole niosą dane
     klienta i to one mają być czyste. PYTANIE AGENTA NIE PRZECHODZI przez
     maskowanie — pisze je pracownik biura o naszym towarze, nie klient
     o sobie, a wycinanie z niego numerów zabrałoby mu sens. */
  if (zostalyDaneOsobowe(String(kontekst.watek)) || (maska && zostalyDaneOsobowe(String(maska.tresc)))) {
    throw new Error("Maskowanie nie oczyściło rozmowy — nic nie wyszło do dostawcy");
  }

  let odp: OdpowiedzNaPytanie;
  try {
    odp = await nadaj({
      watek: kontekst.watek, fakty, zdjecia: zdjecia.zdjecia,
      szkic: maska ? maska.tresc : null,
      historia: dotad.slice(-HISTORII_W_KONTEKSCIE)
        .map((w) => ({ pytanie: w.pytanie, odpowiedz: w.odpowiedz })),
      pytanie: tresc,
      /* Narzędzia czytają tę samą bazę co fakty, ale na żądanie modelu.
         Tylko odczyt i tylko nasz towar — granica stoi w `copilot-narzedzia`. */
      narzedzia: zestawNarzedzi(subiekt),
    });
  } catch (e) {
    zapiszWywolanie(conversationId, null, "blad",
      (e as { slad?: string }).slad || (e as Error).message, kto, teraz,
      (e as { zuzycie?: Tokeny }).zuzycie);
    throw e;
  }

  /* Numery, które stoją już w polu albo w poleceniu agenta, przechodzą sita.
     Za nie odpowiada agent: wpisał je sam albo kazał je wpisać, a sito ma
     łapać numer wzięty przez model z niczego, nie z ręki człowieka. */
  const poprawka = poprawkaSzkicu(odp.szkic, maska, baza, {
    fakty: kontekst.fakty,
    material: `${fakty}\n${kontekst.watek}\n${baza ?? ""}\n${tresc}`,
    wyslaneZdjecia: new Set(zdjecia.zdjecia.map((z) => z.numer)),
    wynikiN: odp.wynikiNarzedzi ?? [],
  });

  const twierdzenia = ocenTwierdzenia(odp.twierdzenia);
  const id = Number(db().prepare(`INSERT INTO copilot_pytanie
    (conversation_id,pytanie,odpowiedz,twierdzenia,model,at,przez,przez_user_id,narzedzia,
     szkic_przed,szkic_po,szkic_odrzucony,szkic_twierdzenia,szkic_zastrzezenia)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(conversationId, tresc, odp.tresc, JSON.stringify(twierdzenia), odp.model,
      teraz.toISOString(), kto.name, kto.id, JSON.stringify(odp.narzedzia ?? []),
      poprawka.przed, poprawka.po, poprawka.odrzucona,
      JSON.stringify(poprawka.twierdzenia), JSON.stringify(poprawka.zastrzezenia)).lastInsertRowid);
  /* Odrzucona poprawka to dalej udane wywołanie: model odpowiedział, a notka
     jest dla agenta użyteczna. Błąd w księdze znaczyłby, że nic nie wróciło. */
  zapiszWywolanie(conversationId, odp, "ok", null, kto, teraz);

  /* Ładunek niesie DŁUGOŚCI, nigdy treści (§19): pytanie agenta bywa
     o konkretnym kliencie, a `events` nie ma retencji. */
  logEvent("copilot_pytanie", kto.name, null, {
    conversationId, znakowPytania: tresc.length, znakowOdpowiedzi: odp.tresc.length,
    wymiana: dotad.length + 1, model: odp.model, tokeny: odp.zuzycie,
    /* Zdjęcia liczbami, jak przy szkicu — patrz blizna w `copilot-zdjecia`. */
    zdjec: zdjecia.zdjecia.length, zdjecBledow: zdjecia.bledow,
    /* Nazwy narzędzi, bez argumentów: argument bywa numerem z rozmowy. */
    narzedzia: (odp.narzedzia ?? []).map((n) => n.nazwa),
    /* Los poprawki kodem, bez tekstu: szkic niesie dane klienta. */
    znakowPrzed: poprawka.przed?.length ?? null, znakowPo: poprawka.po?.length ?? null,
    poprawka: poprawka.rodzaj, powod: poprawka.powod,
  }, kto.id);

  return wymianyRozmowy(conversationId).find((w) => w.id === id)!;
}

/** Czemu poprawka nie weszła: sita szkicu albo znacznik, którego nie wydaliśmy. */
export type KodPoprawki = KodSita | "znacznik_obcy";

interface Poprawka {
  przed: string | null;
  po: string | null;
  odrzucona: string | null;
  twierdzenia: Twierdzenie[];
  zastrzezenia: string[];
  rodzaj: "wersja" | "odrzucona" | "bez_zmian" | "brak";
  powod: KodPoprawki | null;
}

/** Białe znaki zwinięte do jednej spacji: przestawiony akapit to jeszcze nie zmiana. */
const zwinBiale = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Nowa wersja szkicu z odpowiedzi modelu, po wszystkich sitach.
 *
 * Kolejność ma znaczenie. Najpierw odmaskowanie: znacznik, którego nie
 * wydaliśmy, to dana klienta, której model nie widział, więc wersja odpada,
 * zanim cokolwiek ją sprawdzi. Potem sita na tekście ODMASKOWANYM, bo
 * materiał niesie odmaskowaną podstawę, a numer części schowany pod
 * `[telefon 1]` ma się porównać z sobą samym.
 */
function poprawkaSzkicu(
  s: SzkicSurowy | null | undefined, maska: MaskaOdwracalna | null, baza: string | null,
  m: { fakty: Fakt[]; material: string; wyslaneZdjecia: ReadonlySet<string>; wynikiN: WynikWywolania[] },
): Poprawka {
  const brak: Poprawka = {
    przed: null, po: null, odrzucona: null, twierdzenia: [], zastrzezenia: [], rodzaj: "brak", powod: null,
  };
  /* Wersja bez podstawy nie ma czego poprawiać: model napisał szkic od zera,
     a od tego jest przycisk szkicu, z własnym miejscem i pomiarem. */
  if (!s || !maska || baza === null) return brak;
  const odrzuc = (powod: KodPoprawki, zdanie: string): Poprawka =>
    ({ ...brak, przed: baza, odrzucona: zdanie, rodzaj: "odrzucona", powod });

  const tekst = maska.odmaskuj(s.tresc);
  if (tekst.obce.length) {
    return odrzuc("znacznik_obcy", `Copilot wpisał dane klienta, których nie widział `
      + `(${tekst.obce.join(", ")}), więc szkic został bez zmian.`);
  }
  /* Tezy też odmaskowane: numer zadeklarowany pod znacznikiem ma pokryć
     ten sam numer w tekście. Cudzy znacznik w tezie niczego nie psuje, bo
     twierdzenia czyta agent, a nie klient. */
  const sito = sitaSzkicu({
    ...s, tresc: tekst.tresc,
    twierdzenia: s.twierdzenia.map((t) => ({ ...t, teza: maska.odmaskuj(t.teza).tresc })),
  }, m);
  if (!sito.ok) return odrzuc(sito.kod, zdaniePoprawki(sito, tekst.tresc.length, baza.length));
  if (zwinBiale(sito.tresc) === zwinBiale(baza)) return { ...brak, przed: baza, rodzaj: "bez_zmian" };
  return {
    przed: baza, po: sito.tresc, odrzucona: null, twierdzenia: sito.twierdzenia,
    zastrzezenia: s.zastrzezenia.map((z) => maska.odmaskuj(z).tresc),
    rodzaj: "wersja", powod: null,
  };
}

/** Zdanie dla agenta pod odrzuconą poprawką. Mówi, co sito złapało, i że pole stoi. */
function zdaniePoprawki(w: { kod: KodSita; lista: string[] }, znakowPo: number, znakowPrzed: number): string {
  const bez = "więc szkic został bez zmian.";
  switch (w.kod) {
    case "numer_niezadeklarowany":
      return `Copilot użył numeru ${w.lista[0]}, nie mówiąc, skąd go ma, ${bez}`;
    case "fakt_spoza_listy":
      return `Copilot powołał się na ${w.lista[0]}, którego nie dostał, ${bez}`;
    case "zdjecie_spoza_listy":
      return `Copilot powołał się na zdjęcie ${w.lista[0]}, którego nie dostał, ${bez}`;
    case "za_dlugi":
      return `Nowa wersja ma ${znakowPo} znaków, a Allegro przyjmuje ${LIMIT_ZNAKOW}. `
        + `Poprawiany tekst miał ${znakowPrzed}, ${bez}`;
  }
}

function zapiszWywolanie(
  conversationId: number, odp: OdpowiedzNaPytanie | null, wynik: "ok" | "blad",
  blad: string | null, kto: { id: number | null }, teraz: Date,
  /* Rundy narzędzi zapłacone przed błędem. Bez nich porażka po czterech
     rundach ważyłaby w pomiarze zero, a kosztowała cztery żądania. */
  zuzyciePrzedBledem?: Tokeny,
): void {
  const t = odp?.zuzycie ?? zuzyciePrzedBledem;
  /* Model pusty przy błędzie bez rund, jak dotąd — pomiar go pomija. Z rundami
     wpisujemy model z konfiguracji, bo inaczej pomiar zgubiłby ich koszt. */
  const model = odp?.model ?? (t && (t.wej || t.wyj) ? config.copilot.model : "");
  db().prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at)
    VALUES ('pytanie',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(conversationId, model, t?.wej ?? 0, t?.wyj ?? 0,
      t?.cacheZapis ?? 0, t?.cacheOdczyt ?? 0, odp?.ms ?? 0, wynik,
      blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString());
}
