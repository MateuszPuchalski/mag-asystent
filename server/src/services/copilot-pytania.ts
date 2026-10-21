import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { config } from "../config.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { logEvent } from "./events.js";
import {
  zamaskujOdwracalnie, zostalyDaneOsobowe, type MaskaOdwracalna, type TrescBezpieczna,
} from "./copilot-maskowanie.js";
import type { Tokeny } from "./copilot-koszt.js";
import { kodBledu, sladPorazki, zapiszWKsiedze } from "./copilot-ksiega.js";
import {
  dopiszLinkiOfert, kontekstSzkicu, loginRozmowcy, ocenTwierdzenia, sitaSzkicu, szkicCopilota,
  type Fakt, type FaktyBezpieczne, type KodSita, type SzkicSurowy, type Twierdzenie,
  type TwierdzenieSurowe,
} from "./copilot-szkic.js";
import { ofertyPoSygnaturze } from "./allegro-oferty-po-sygnaturze.js";
import {
  ponumerujZdjeciaAgenta, przygotujZdjeciaRozmowy, przyjmijZdjeciaAgenta, spisZdjec,
  SUFIT_SZTUK_DOPYTANIA, SUFIT_ZDJEC, type Pobieracz, type ZdjecieZBramki,
} from "./copilot-zdjecia.js";
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
  /** Zdjęcia, które agent dołączył do TEGO pytania. Pusta lista = bez zdjęć. */
  zdjecia: ZdjecieWymiany[];
}

/**
 * Ślad zdjęcia agenta przy wymianie. Bajtów oryginału nie ma, bo poszły
 * do modelu tylko w tamtym żądaniu (decyzja właściciela). Zostaje miniatura,
 * żeby agent widział, na co model patrzył, gdy cytował `numer`.
 */
export interface ZdjecieWymiany {
  /** Numer nadany w TYM pytaniu, np. „Z9” po zdjęciach rozmowy Z1–Z8. */
  numer: string;
  nazwa: string;
  typ: string;
  bajtow: number;
  /** JPEG z panelu w base64; `null`, gdy panel jej nie zrobił. */
  miniatura: string | null;
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
  /** Ile żądań poszło do dostawcy. Brak = nadawca bez pętli, jak atrapa. */
  rund?: number;
  /** Wersja instrukcji, jak przy szkicu. Brak = atrapa i NULL w księdze. */
  wersjaInstrukcji?: string;
}

/** Materiał, na którym model odpowiada. Wszystko przeszło przez maskowanie. */
export interface KontekstPytania {
  watek: TrescBezpieczna;
  fakty: FaktyBezpieczne;
  zdjecia: ZdjecieZBramki[];
  /** Tekst z pola agenta albo szkic Copilota, zamaskowany; `null` = nie ma czego poprawiać. */
  szkic: TrescBezpieczna | null;
  /**
   * Poprzednie wymiany, od najstarszej. Bez obrazów: `zdjecAgenta` mówi tylko,
   * ile agent wtedy dołączył, żeby model nie cytował starego Z9 jako obecnego.
   */
  historia: Array<{ pytanie: string; odpowiedz: string; zdjecAgenta: number }>;
  pytanie: string;
  /** Odczyt naszej bazy na żądanie modelu. `null` = bez narzędzi. */
  narzedzia: ZestawNarzedzi | null;
}

export type NadawcaPytania = (k: KontekstPytania) => Promise<OdpowiedzNaPytanie>;

/** Wymiany rozmowy, od najstarszej. Czysty ODCZYT. */
export function wymianyRozmowy(
  conversationId: number, database: DatabaseSync = db(),
): WymianaCopilota[] {
  /* Jedno zapytanie na całą rozmowę, nie jedno na wymianę: rozmowa ma do
     `SUFIT_PYTAN` wymian, a ekran czyta je wszystkie naraz. */
  const zdjecia = new Map<number, ZdjecieWymiany[]>();
  for (const z of database.prepare(
    `SELECT z.pytanie_id, z.numer, z.nazwa, z.typ, z.bajtow, z.miniatura
       FROM copilot_pytanie_zdjecie z JOIN copilot_pytanie p ON p.id = z.pytanie_id
      WHERE p.conversation_id=? ORDER BY z.id`)
    .all(conversationId) as Array<Record<string, unknown>>) {
    const lista = zdjecia.get(Number(z.pytanie_id)) ?? [];
    lista.push({
      numer: String(z.numer), nazwa: String(z.nazwa), typ: String(z.typ), bajtow: Number(z.bajtow),
      miniatura: z.miniatura == null ? null : Buffer.from(z.miniatura as Uint8Array).toString("base64"),
    });
    zdjecia.set(Number(z.pytanie_id), lista);
  }
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
      zdjecia: zdjecia.get(Number(w.id)) ?? [],
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
 *
 * `o.zdjecia` to zdjęcia z ręki agenta, prosto z ciała żądania. Przechodzą
 * bramkę `przyjmijZdjeciaAgenta` przed siecią, a zła lista kończy pytanie
 * zdaniem, zanim cokolwiek wyjdzie do Allegro albo do dostawcy modelu.
 */
export async function zadajPytanie(
  conversationId: number, pytanie: string, kto: { id: number | null; name: string },
  nadaj: NadawcaPytania, subiekt: SubiektAdapter,
  o: { szkic?: string | null; teraz?: Date; pobierzZdjecie?: Pobieracz; zdjecia?: unknown } = {},
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
  const przyjete = przyjmijZdjeciaAgenta(o.zdjecia);
  const bajtowAgenta = przyjete.reduce((s, z) => s + z.bajtow, 0);

  const dotad = wymianyRozmowy(conversationId);
  if (dotad.length >= SUFIT_PYTAN) {
    throw new Error(`Ta rozmowa ma już ${SUFIT_PYTAN} dopytań. `
      + "Jeśli sprawa dalej nie jest jasna, fakty jej nie rozstrzygną — zapytaj klienta.");
  }

  const surowy = kontekstSzkicu(conversationId, subiekt);
  const kontekst = dopiszLinkiOfert(surowy, await ofertyPoSygnaturze(
    [...surowy.kartoteki.values()].map((x) => x.symbol)));

  /* Zdjęcia tą samą bramką co przy szkicu. Dopytanie „co dokładnie widać na
     tabliczce" bez zdjęcia byłoby pytaniem o nic. Sufit sztuk jest wyższy niż
     przy szkicu, bo pytanie klika człowiek; powód przy stałej.
     Zdjęcia agenta mają pierwszeństwo we wspólnym suficie bajtów (decyzja
     właściciela): dołączył je do TEGO pytania, więc bez nich pytanie
     traci sens. Zdjęcia rozmowy wypełniają resztę. */
  const zdjecia = await przygotujZdjeciaRozmowy(
    db(), conversationId, o.pobierzZdjecie, SUFIT_SZTUK_DOPYTANIA, SUFIT_ZDJEC.lacznie - bajtowAgenta);
  const odAgenta = ponumerujZdjeciaAgenta(przyjete, zdjecia.zdjecia.length);
  /* Kolejność obrazów w żądaniu = kolejność w spisie: najpierw rozmowa,
     potem agent. Numer w spisie wskazuje wtedy obraz na tym samym miejscu. */
  const wszystkie: ZdjecieZBramki[] = [...zdjecia.zdjecia, ...odAgenta];
  const spis = spisZdjec(zdjecia, odAgenta);
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
      watek: kontekst.watek, fakty, zdjecia: wszystkie,
      szkic: maska ? maska.tresc : null,
      historia: dotad.slice(-HISTORII_W_KONTEKSCIE)
        .map((w) => ({ pytanie: w.pytanie, odpowiedz: w.odpowiedz, zdjecAgenta: w.zdjecia.length })),
      pytanie: tresc,
      /* Narzędzia czytają tę samą bazę co fakty, ale na żądanie modelu.
         Tylko odczyt i tylko nasz towar — granica stoi w `copilot-narzedzia`. */
      narzedzia: zestawNarzedzi(subiekt),
    });
  } catch (e) {
    const p = sladPorazki(e);
    zapiszWywolanie(conversationId, null, "blad",
      (e as { slad?: string }).slad || (e as Error).message, kto, teraz, {
        zuzycie: p.zuzycie, kodBledu: kodBledu(e), rund: p.rund, narzedzi: p.narzedzi,
        wersjaInstrukcji: p.wersjaInstrukcji,
      });
    throw e;
  }

  /* Numery, które stoją już w polu albo w poleceniu agenta, przechodzą sita.
     Za nie odpowiada agent: wpisał je sam albo kazał je wpisać, a sito ma
     łapać numer wzięty przez model z niczego, nie z ręki człowieka. */
  const poprawka = poprawkaSzkicu(odp.szkic, maska, baza, {
    fakty: kontekst.fakty,
    material: `${fakty}\n${kontekst.watek}\n${baza ?? ""}\n${tresc}`,
    /* Numery agenta też: model wolno oprzeć wersję na jego kartce, bo
       dostał ją w tym żądaniu, z numerem w spisie. */
    wyslaneZdjecia: new Set(wszystkie.map((z) => z.numer)),
    wynikiN: odp.wynikiNarzedzi ?? [],
  });

  const twierdzenia = ocenTwierdzenia(odp.twierdzenia);
  /* Wymiana i ślad jej zdjęć w jednej transakcji: wymiana bez zdjęć, które
     model widział, cytowałaby Z9, którego nikt już nie zobaczy. */
  const id = transaction(db(), () => {
    const nowa = Number(db().prepare(`INSERT INTO copilot_pytanie
      (conversation_id,pytanie,odpowiedz,twierdzenia,model,at,przez,przez_user_id,narzedzia,
       szkic_przed,szkic_po,szkic_odrzucony,szkic_twierdzenia,szkic_zastrzezenia)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(conversationId, tresc, odp.tresc, JSON.stringify(twierdzenia), odp.model,
        teraz.toISOString(), kto.name, kto.id, JSON.stringify(odp.narzedzia ?? []),
        poprawka.przed, poprawka.po, poprawka.odrzucona,
        JSON.stringify(poprawka.twierdzenia), JSON.stringify(poprawka.zastrzezenia)).lastInsertRowid);
    const zdjecie = db().prepare(`INSERT INTO copilot_pytanie_zdjecie
      (pytanie_id,numer,nazwa,typ,bajtow,miniatura) VALUES (?,?,?,?,?,?)`);
    for (const z of odAgenta) zdjecie.run(nowa, z.numer, z.nazwa, z.typ, z.bajtow, z.miniatura);
    return nowa;
  })();
  /* Odrzucona poprawka to dalej udane wywołanie: model odpowiedział, a notka
     jest dla agenta użyteczna. Błąd w księdze znaczyłby, że nic nie wróciło. */
  /* Kod przy udanym wywołaniu to powód odrzuconej poprawki: wymiana się
     udała, ale wersja odpadła na sicie, a pomiar ma to widzieć. Twierdzenia
     z wersji, gdy weszła, bo to ona idzie do klienta; inaczej z notki. */
  zapiszWywolanie(conversationId, odp, "ok", null, kto, teraz, {
    kodBledu: poprawka.powod,
    twierdzenia: poprawka.rodzaj === "wersja" ? poprawka.twierdzenia : twierdzenia,
  });

  /* Ładunek niesie DŁUGOŚCI, nigdy treści (§19): pytanie agenta bywa
     o konkretnym kliencie, a `events` nie ma retencji. */
  logEvent("copilot_pytanie", kto.name, null, {
    conversationId, znakowPytania: tresc.length, znakowOdpowiedzi: odp.tresc.length,
    wymiana: dotad.length + 1, model: odp.model, tokeny: odp.zuzycie,
    /* Zdjęcia liczbami, jak przy szkicu — patrz blizna w `copilot-zdjecia`. */
    zdjec: zdjecia.zdjecia.length, zdjecBledow: zdjecia.bledow,
    /* Zdjęcia agenta osobno, bo `zdjec` czyta sonda jako „czy zdjęcia
       klienta docierają do modelu”. Bez nazw plików: nazwa bywa daną osobową. */
    zdjecAgenta: odAgenta.length, zdjecAgentaBajtow: bajtowAgenta,
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
  dodatkowo: {
    /* Rundy narzędzi zapłacone przed błędem. Bez nich porażka po czterech
       rundach ważyłaby w pomiarze zero, a kosztowała cztery żądania. */
    zuzycie?: Tokeny; kodBledu?: string | null; rund?: number; narzedzi?: number;
    wersjaInstrukcji?: string; twierdzenia?: Twierdzenie[];
  } = {},
): void {
  const t = odp?.zuzycie ?? dodatkowo.zuzycie;
  /* Model pusty przy błędzie bez rund, jak dotąd — pomiar go pomija. Z rundami
     wpisujemy model z konfiguracji, bo inaczej pomiar zgubiłby ich koszt. */
  const model = odp?.model ?? (t && (t.wej || t.wyj) ? config.copilot.model : "");
  zapiszWKsiedze(db(), {
    zadanie: "pytanie", conversationId, model, zuzycie: t, ms: odp?.ms ?? 0, wynik, blad,
    przezUserId: kto.id, at: teraz, zrodlo: "dopytanie", kodBledu: dodatkowo.kodBledu,
    rund: odp ? odp.rund ?? 1 : dodatkowo.rund,
    narzedzi: odp ? odp.narzedzia.length : dodatkowo.narzedzi,
    wersjaInstrukcji: odp?.wersjaInstrukcji ?? dodatkowo.wersjaInstrukcji,
    twierdzenia: dodatkowo.twierdzenia,
  });
}
