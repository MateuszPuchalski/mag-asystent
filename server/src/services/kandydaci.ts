import type { DatabaseSync } from "node:sqlite";
import { db, ftsDostepne } from "../db/db.js";
import { config } from "../config.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { kartotekaOferty, kartotekaPoSku } from "./dopasowanie-sku.js";
import { podzielZamienniki } from "./zamienniki.js";
import { zamiennicyOem } from "./zamiennosc-oem.js";
import { doborRozmowy } from "./dobor.js";
import { kluczModelu, zastosowaniaModelu, type Zastosowanie } from "./wiedza.js";
import { ocenWarunki, type MaszynaKlienta } from "./warunki-zastosowania.js";
import { silnikZTekstu, zabudowyMaszyny } from "./silniki.js";
import { pasowaniaTowaru, type Kartoteka } from "./pasowania.js";
import { szukajPoIdentyfikatorze } from "./identyfikatory.js";
import { szukajPelnotekst } from "./pelnotekst.js";
import { zwin } from "../tekst.js";

/**
 * Kandydaci doboru w trzech grupach (`docs/dobor-od-zera.md` §4.3): co
 * wskazał klient, co potwierdza wiedza i co jest podobne po nazwie.
 *
 * Kandydatów szuka się WYŁĄCZNIE z danych doboru, nigdy z treści wiadomości
 * (blizna „szarpaka": zgadywanie po treści prowadziło do cudzej kartoteki).
 *
 * Kandydaci nie jadą w odczycie rozmowy: tamten odświeża się na każde
 * zdarzenie szyny, a to jest wyszukiwarka i parser opisu. Odczyt niczego
 * nie zapisuje.
 */

export type GrupaKandydata = "numer" | "wiedza" | "podobne";
export type PewnoscKandydata = "potwierdzone" | "prawdopodobne" | "do_sprawdzenia";

export interface KandydatDoboru {
  twId: number; symbol: string; nazwa: string;
  /** Dostępne na magazynie głównym; `null` = brak stanu. */
  stan: number | null;
  grupa: GrupaKandydata; pewnosc: PewnoscKandydata;
  /** Jedno zdanie: skąd ten kandydat. */
  powod: string;
  /** Zdania innych źródeł, które trafiły w tę samą kartotekę. */
  takze: string[];
  /** Zastrzeżenia: warunek, kilka silników, negatyw z wiedzy. */
  ostrzezenia: string[];
}

export interface NegatywDoboru { twId: number; symbol: string; nazwa: string | null; powod: string; zrodlo: string }

export interface KandydaciDoboru {
  kandydaci: KandydatDoboru[];
  /** Numery z pola `oem` bez kartoteki. Nie da się ich wybrać. */
  bezKartoteki: Array<{ numer: string; zdanie: string }>;
  negatywne: NegatywDoboru[];
  /** Czego zabrakło do szukania, zdaniami. Pusta lista = sprawdzono wszystko. */
  brakuje: string[];
}

const GRUPY: GrupaKandydata[] = ["numer", "wiedza", "podobne"];
const SILA: Record<PewnoscKandydata, number> = { potwierdzone: 3, prawdopodobne: 2, do_sprawdzenia: 1 };

/**
 * ZNACZNIK MOCNEJ PRZESŁANKI przy trafieniu po numerze.
 *
 * Kosztowało to szkic o koło pasowe do Husqvarny TC38. Klient podał numer
 * producenta, kartoteka miała go w opisie i stała pierwsza — a model odradził
 * zakup, bo z NAZWY kartoteki wywnioskował inną szerokość kosiska. Słabe
 * drogi miały przy sobie „nie dowód", mocne nie miały nic, więc domysł
 * pobił numer. Jedna stała, bo kopie zdania rozjechałyby się przy poprawce.
 */
const PO_IDENTYFIKATORZE = "— trafienie po IDENTYFIKATORZE, nie po opisie ani nazwie";

/* Deklaracja sprzedawcy w opisie aukcji i numer z katalogu dostawcy to
   świadectwa różnej wagi, więc zdanie nazywa źródło numeru. Każda gałąź
   osobno, żeby nowe źródło nie przemyciło się jako „z opisu kartoteki". */
function zdanieZrodlaNumeru(
  t: { zrodlo: string; nazwaRodzaju: string; wartosc: string; dodal: string; ofertaId: string | null; dostawca: string | null },
  symbol: string,
): string {
  const czolo = `numer ${t.nazwaRodzaju} ${t.wartosc}`;
  if (t.zrodlo === "reczne") return `${czolo} wpisany ręcznie przez ${t.dodal} ${PO_IDENTYFIKATORZE}`;
  if (t.zrodlo === "oferta") {
    return `${czolo} z opisu NASZEJ oferty${t.ofertaId ? ` ${t.ofertaId}` : ""} przy kartotece „${symbol}” ${PO_IDENTYFIKATORZE}`;
  }
  if (t.zrodlo === "dostawca") {
    return `${czolo} z tabeli odsyłaczy dostawcy ${t.dostawca ?? "(bez nazwy)"} przy kartotece „${symbol}” ${PO_IDENTYFIKATORZE}`;
  }
  return `${czolo} z opisu kartoteki „${symbol}” ${PO_IDENTYFIKATORZE}`;
}

/** Coś, co wygląda na symbol: bez spacji, z cyfrą, rozsądnej długości. */
const wygladaNaSymbol = (v: string | null): v is string =>
  Boolean(v && /\d/.test(v) && /^[A-Za-z0-9][A-Za-z0-9\-_./+*]{1,39}$/.test(v));
/* Luźniej niż symbol: `532 16 56-30` ma spacje. Dwie cyfry i cztery znaki,
   żeby `x2` albo `S` nie uruchamiały szukania po numerze. */
const wygladaNaNumer = (v: string | null): v is string =>
  Boolean(v && v.trim().length >= 4 && v.trim().length <= 40 && (v.match(/\d/g) ?? []).length >= 2);

/** Oferta, o którą chodzi: ręczne wskazanie bije numer z wiadomości. */
export function ofertaRozmowy(database: DatabaseSync, conversationId: number): { konto: number; ofertaId: string } | null {
  const konto = database.prepare("SELECT channel_account_id AS konto FROM conversation WHERE id=?")
    .get(conversationId) as { konto: number } | undefined;
  if (!konto) throw new Error("Nie znaleziono rozmowy");
  const reczna = database.prepare(`SELECT payload FROM conversation_event
    WHERE conversation_id=? AND event_type='offer_linked_manually' ORDER BY id DESC LIMIT 1`)
    .get(conversationId) as { payload: string | null } | undefined;
  if (reczna?.payload) {
    const p = JSON.parse(reczna.payload) as { ofertaId?: string };
    if (p.ofertaId) return { konto: Number(konto.konto), ofertaId: p.ofertaId };
  }
  /* Ta sama reguła co w `osRozmowy`: numer z najnowszej wiadomości KLIENTA,
     a gdy klient go nie podał — z najnowszej naszej. Najnowszej PO CZASIE:
     `id` starych wierszy nie rośnie z czasem. */
  const m = database.prepare(`SELECT related_object_id AS oferta FROM message
    WHERE conversation_id=? AND related_object_type='OFFER' AND related_object_id IS NOT NULL
    ORDER BY (direction='incoming') DESC, sent_at DESC, id DESC LIMIT 1`)
    .get(conversationId) as { oferta: string } | undefined;
  return m ? { konto: Number(konto.konto), ofertaId: String(m.oferta) } : null;
}

function towar(database: DatabaseSync, twId: number) {
  return database.prepare(`SELECT t.tw_id, t.symbol, t.nazwa, t.opis,
      CASE WHEN s.tw_id IS NULL THEN NULL ELSE COALESCE(s.stan,0) - COALESCE(s.stan_rez,0) END AS dostepne
    FROM sgt_towar t LEFT JOIN sgt_stan s ON s.tw_id=t.tw_id AND s.mag_id=?
    WHERE t.tw_id=?`).get(config.magId.MAG, twId) as
    { tw_id: number; symbol: string; nazwa: string; opis: string | null; dostepne: number | null } | undefined;
}

/**
 * Wpis z warunkami przeciw maszynie z doboru — jedna reguła dla wpisu do
 * maszyny i do silnika, żeby oba mówiły to samo tymi samymi słowami.
 *
 * POZYTYW: warunek spełniony albo brak → kandydat; „nie wiem" → kandydat
 * do sprawdzenia z ostrzeżeniem, O CO zapytać (zgubić go byłoby gorzej, to
 * często jedyna właściwa część); złamany → negatyw „poza zakresem wpisu",
 * bo katalog, który mówi „od nr X", pod X wskazuje INNĄ część.
 * NEGATYW: stoi, przy „nie wiem" z dopiskiem; złamany dotyczy innych
 * egzemplarzy i milknie.
 */
type Werdykt =
  | { rodzaj: "kandydat"; pewnosc: PewnoscKandydata | null; ostrzezenie: string | null; dopisek: string }
  | { rodzaj: "negatyw"; powod: string }
  | { rodzaj: "nic" };

export function werdyktWarunkow(z: Zastosowanie, maszyna: MaszynaKlienta, czyje: "maszyny" | "silnika"): Werdykt {
  const { ocena, zdanie } = ocenWarunki(z.warunki, maszyna, czyje);
  if (z.polaryzacja === "nie_pasuje") {
    if (ocena === "niespelnione") return { rodzaj: "nic" };
    const powod = z.zdaniePowodu ?? "nie pasuje";
    return { rodzaj: "negatyw", powod: ocena === "nieznane" ? `${powod} — o ile: ${zdanie}` : powod };
  }
  if (ocena === "niespelnione") return { rodzaj: "negatyw", powod: `poza zakresem wpisu: ${zdanie}` };
  if (ocena === "nieznane") {
    return { rodzaj: "kandydat", pewnosc: "do_sprawdzenia", ostrzezenie: `pasuje warunkowo: ${zdanie}`, dopisek: "" };
  }
  return { rodzaj: "kandydat", pewnosc: null, ostrzezenie: null, dopisek: ocena === "spelnione" ? `; ${zdanie}` : "" };
}

export function kandydaciDoboru(
  conversationId: number, subiekt: SubiektAdapter, database: DatabaseSync = db(),
): KandydaciDoboru & { kotwice: Kartoteka[] } {
  const { dane } = doborRozmowy(conversationId, database);
  const oferta = ofertaRozmowy(database, conversationId);
  const trafione = new Map<number, KandydatDoboru>();
  const brakuje: string[] = [];
  const negatywne: NegatywDoboru[] = [];
  const bezKartoteki: KandydaciDoboru["bezKartoteki"] = [];
  /* KOTWICE: kartoteki, które wskazał klient — symbolem, numerem albo
     ofertą. Z nich rośnie grupa pasowań („mam gaźnik W09-0211, jaka
     uszczelka"), a szkic Copilota bierze je jako kartoteki z kontekstu. */
  const kotwice = new Map<number, Kartoteka>();

  /* Kartoteka trafiona kilka razy stoi RAZ, w pierwszej grupie z kolejności
     numer, wiedza, podobne — dlatego grupy biegną w tej kolejności. Pewność
     bierze najmocniejsze źródło, a zdania pozostałych idą do `takze`, żeby
     dowód nie zniknął ze szkicu tylko dlatego, że inna grupa była pierwsza. */
  const dodaj = (twId: number, grupa: GrupaKandydata, pewnosc: PewnoscKandydata, powod: string, ostrzezenia: string[] = []) => {
    const w = towar(database, twId);
    if (!w) return null;
    const juz = trafione.get(twId);
    if (!juz) {
      trafione.set(twId, { twId, symbol: w.symbol, nazwa: w.nazwa, stan: w.dostepne == null ? null : Number(w.dostepne),
        grupa, pewnosc, powod, takze: [], ostrzezenia: [...new Set(ostrzezenia)] });
      return w;
    }
    if (SILA[pewnosc] > SILA[juz.pewnosc]) juz.pewnosc = pewnosc;
    if (powod !== juz.powod && !juz.takze.includes(powod)) juz.takze.push(powod);
    for (const o of ostrzezenia) if (!juz.ostrzezenia.includes(o)) juz.ostrzezenia.push(o);
    return w;
  };
  const kotwica = (w: { tw_id: number; symbol: string; nazwa: string } | null) => {
    if (w) kotwice.set(w.tw_id, { twId: w.tw_id, symbol: w.symbol, nazwa: w.nazwa });
  };

  /* ── NUMER: co wskazał klient ──────────────────────────────────────────
     Symbol i EAN zawsze `literowki: false`: furtka na literówki prowadziła
     już do cudzej kartoteki (blizna „szarpaka"). */
  const wpisane = [dane.oem, dane.nazwaCzesci];
  const trafioneNumery = new Set<string>();
  for (const q of wpisane.filter(wygladaNaSymbol)) {
    const cyfry = q.replace(/\D/g, "");
    for (const t of subiekt.search(q, 20, { literowki: false })) {
      if (t.sym.trim().toUpperCase() === q.toUpperCase()) {
        trafioneNumery.add(zwin(q));
        kotwica(dodaj(t.id, "numer", "prawdopodobne", `Dokładny symbol „${q}” z danych doboru ${PO_IDENTYFIKATORZE}`));
      } else if (cyfry.length >= 8 && t.ean === cyfry) {
        trafioneNumery.add(zwin(q));
        kotwica(dodaj(t.id, "numer", "prawdopodobne", `Kod EAN ${cyfry} z danych doboru ${PO_IDENTYFIKATORZE}`));
      }
    }
  }
  const numery = [...new Set(wpisane.filter(wygladaNaNumer))];
  if (numery.length === 0) brakuje.push("Brak numeru części w danych doboru — nie ma czego szukać po numerze.");
  for (const numer of numery) {
    const trafienia = szukajPoIdentyfikatorze(numer, database);
    for (const t of trafienia) {
      const w = towar(database, t.twId);
      if (w) kotwica(dodaj(t.twId, "numer", "prawdopodobne", zdanieZrodlaNumeru(t, w.symbol)));
    }
    /* Numer bez kartoteki NIE znika: „nie mamy tego u siebie" jest
       odpowiedzią dla klienta. Tylko z pola `oem` — numer wpisany jako
       nazwa części nie jest deklaracją „mam numer producenta" — i nie dla
       numeru, który sam jest naszym symbolem. */
    if (trafienia.length === 0 && numer === dane.oem && !trafioneNumery.has(zwin(numer))) {
      bezKartoteki.push({ numer: numer.trim(), zdanie: "numer z danych doboru — nie ma go w żadnej kartotece ani opisie" });
    }
  }

  if (!oferta) {
    brakuje.push("Rozmowa bez oferty — nie ma kartoteki, o którą pyta klient.");
  } else {
    const sku = database.prepare("SELECT sku FROM offer_snapshot WHERE channel_account_id=? AND external_id=?")
      .get(oferta.konto, oferta.ofertaId) as { sku: string | null } | undefined;
    const k = kartotekaOferty(database, oferta.konto, oferta.ofertaId, sku ? sku.sku : undefined);
    const w = k.twId === null ? null
      : dodaj(k.twId, "numer", "prawdopodobne", `Kartoteka oferty ${oferta.ofertaId} — ${k.zrodlo}`);
    if (!w) {
      brakuje.push(`Oferta ${oferta.ofertaId} bez kartoteki: ${k.twId === null ? k.zrodlo : "kartoteki nie ma w read-modelu Subiekta"}.`);
    } else {
      kotwica(w);
      /* Zamiennik z opisu jest do sprawdzenia: opis mówi „zamiennie", ale
         nie mówi, do której maszyny. */
      const { znane } = podzielZamienniki(w.opis ?? "", w.symbol, (s) => kartotekaPoSku(database, s).stan !== "brak");
      for (const symbol of znane) {
        const z = kartotekaPoSku(database, symbol);
        if (z.stan === "jedno" && z.twId !== null) dodaj(z.twId, "numer", "do_sprawdzenia", `Zamiennik z opisu kartoteki „${w.symbol}”`);
      }
      /* Para przez wspólny numer oryginału, ZATWIERDZONA przez człowieka.
         Nie mocniej niż „prawdopodobne": zamiennik nie bywa pewniejszy od
         kartoteki oferty, którą zastępuje. */
      for (const { kartoteka, zamiennosc } of zamiennicyOem(w.tw_id, database)) {
        dodaj(kartoteka.twId, "numer", "prawdopodobne", zamiennosc.zdanie);
      }
    }
  }

  /* ── WIEDZA: co potwierdza baza ────────────────────────────────────────
     Tylko ZATWIERDZONE wpisy: propozycja w kolejce nie jest wiedzą. Pewność
     niesie sam wpis, a zdanie źródła pisze serwis wiedzy — kandydat i szkic
     mówią to samo. */
  const negatyw = (twId: number, symbol: string, powod: string, zrodlo: string) => {
    const w = towar(database, twId);
    negatywne.push({ twId, symbol: w?.symbol ?? symbol, nazwa: w?.nazwa ?? null, powod, zrodlo });
  };
  if (!dane.marka || !dane.model) {
    brakuje.push("Brak marki i modelu maszyny — baza wiedzy nie ma czego sprawdzić.");
  } else {
    const maszyna = [dane.marka, dane.model, dane.wariant].filter(Boolean).join(" ");
    const klucz = kluczModelu("maszyna", dane.marka, dane.model, dane.wariant);
    /* ── BEZ WARIANTU, GDY DOKŁADNY KLUCZ MILCZY ────────────────────────
       Agent wpisał HECHT 1803S z wariantem DYM1182c, a wiedza z listy
       zgodności mówiła „Hecht 1803S". Druga próba idzie po marce i modelu
       TYLKO, gdy pierwsza nie dała żadnego pozytywu: wpis dla wariantu jest
       mocniejszy i nie wolno go rozmyć. Kandydat z drugiej próby ma
       najwyżej „prawdopodobne", bo wariant bywa tym, co zmienia część. */
    const dokladne = zastosowaniaModelu(klucz, database);
    const zapas = dane.wariant && !dokladne.some((z) => z.polaryzacja !== "nie_pasuje")
      ? zastosowaniaModelu(kluczModelu("maszyna", dane.marka, dane.model, null), database) : [];
    const dopisek = ` — wpis dla ${dane.marka} ${dane.model} bez wariantu, wariant niesprawdzony`;
    for (const [z, zZapasu] of [...dokladne.map((z) => [z, false] as const), ...zapas.map((z) => [z, true] as const)]) {
      const werdykt = werdyktWarunkow(z, dane, "maszyny");
      const zrodlo = z.zdanieZrodla + (zZapasu ? dopisek : "");
      if (werdykt.rodzaj === "negatyw") negatyw(z.twId, z.symbol, werdykt.powod, zrodlo);
      if (werdykt.rodzaj !== "kandydat") continue;
      const zWpisu: PewnoscKandydata = zZapasu && z.pewnosc === "potwierdzone" ? "prawdopodobne" : z.pewnosc;
      dodaj(z.twId, "wiedza", werdykt.pewnosc ?? zWpisu, z.zdanieZrodla + werdykt.dopisek + (zZapasu ? dopisek : ""),
        werdykt.ostrzezenie ? [werdykt.ostrzezenie] : []);
    }

    /* PRZEZ SILNIK. Filtr, gaźnik i świeca pasują do SILNIKA, a kupujący zna
       model kosiarki. Wyłącznie przez zatwierdzoną zabudowę: pole „silnik"
       to wolny tekst („B&S 450E" nigdy nie trafi na „Briggs & Stratton
       450E"), a rozbijanie go byłoby zgadywaniem.

       PEWNOŚĆ Z NAJSŁABSZEGO OGNIWA. Twierdzenia są dwa („część pasuje do
       silnika" i „silnik stoi w tej maszynie") i łańcuch jest wart tyle, co
       słabsze. Maszyna z kilkoma silnikami NIGDY nie daje „potwierdzone":
       klient zna model kosiarki, nie wersję silnika, a milcząca pewność
       kończy się zwrotem „nie pasuje". */
    const zabudowy = zabudowyMaszyny(klucz, database);
    if (zabudowy.length === 0) {
      /* Pole „silnik" czytamy tu wyłącznie do zdania: agent ma wiedzieć, czy
         brakuje wpisu w słowniku, czy zabudowy. Kandydatów z aliasu nie ma. */
      const tekst = String(dane.silnik ?? "").trim();
      const alias = tekst ? silnikZTekstu(tekst, database) : null;
      brakuje.push(`Nie wiadomo, jaki silnik stoi w ${maszyna}`
        + (alias ? ` — „${tekst}” to ${alias.silnik.etykieta} wg słownika, ale zabudowy nikt nie zatwierdził.`
          : tekst ? ` — „${tekst}” nie ma w słowniku silników.` : "."));
    }
    const kilka = zabudowy.length > 1 ? [`${maszyna} bywa z kilkoma silnikami — potwierdź z tabliczki znamionowej`] : [];
    for (const zab of zabudowy) {
      for (const z of zastosowaniaModelu(zab.silnik.klucz, database)) {
        /* Warunki wpisu do SILNIKA dotyczą silnika, a dobór zna tabliczkę
           maszyny — stąd „silnika": wynik to najwyżej „nie wiem". */
        const werdykt = werdyktWarunkow(z, dane, "silnika");
        const zrodlo = `${z.zdanieZrodla}; ${zab.zdanieZrodla}`;
        if (werdykt.rodzaj === "negatyw") negatyw(z.twId, z.symbol, werdykt.powod, zrodlo);
        if (werdykt.rodzaj !== "kandydat") continue;
        const pewne = z.pewnosc === "potwierdzone" && zab.pewnosc === "potwierdzone" && kilka.length === 0;
        dodaj(z.twId, "wiedza", werdykt.pewnosc ?? (pewne ? "potwierdzone" : "prawdopodobne"), zrodlo,
          [...kilka, ...(werdykt.ostrzezenie ? [werdykt.ostrzezenie] : [])]);
      }
    }
  }

  /* PASOWANIE: części, które pasują DO kotwicy (uszczelka do gaźnika).
     Wprost i przez zamiennik; przechodnie nigdy „potwierdzone" — liczy to
     serwis pasowań. Nie filtrujemy po nazwie części: agent czyta nazwy. */
  for (const k of kotwice.values()) {
    const p = pasowaniaTowaru(k.twId, database);
    for (const t of p.pasujace) dodaj(t.czesc.twId, "wiedza", t.pewnosc, t.zdanie);
    for (const n of p.negatywne) {
      if (n.doCzego.twId === k.twId) negatyw(n.czesc.twId, n.czesc.symbol, n.zdaniePowodu ?? "nie pasuje", n.zdanieZrodla);
    }
  }

  /* ── PODOBNE: po nazwie ──────────────────────────────────────────────────
     bm25 po symbolu, nazwie i opisie, wyłącznie z danych doboru. Trafienie
     po treści to podpowiedź, nie dowód. */
  if (!dane.nazwaCzesci) brakuje.push("Brak nazwy części — nie ma czego szukać po nazwie.");
  const fraza = [dane.nazwaCzesci, dane.marka, dane.model].filter(Boolean).join(" ");
  if (!ftsDostepne()) {
    brakuje.push("Wyszukiwanie po nazwie niedostępne — SQLite bez FTS5.");
  } else if (fraza) {
    for (const t of szukajPelnotekst(dane.nazwaCzesci ?? "", 5, database, [dane.marka ?? "", dane.model ?? ""])) {
      dodaj(t.twId, "podobne", "do_sprawdzenia", `trafienie po treści kartoteki dla „${fraza}” — nie dowód`);
    }
  }

  /* Negatyw o kartotece z listy stoi też przy niej: ta sama część bywa
     kandydatem z oferty i negatywem z wiedzy naraz, a kandydat wędruje do
     szkicu osobno i ma nieść swoje zastrzeżenie. */
  for (const n of negatywne) {
    const k = trafione.get(n.twId);
    const zdanie = `${n.powod} — ${n.zrodlo}`;
    if (k && !k.ostrzezenia.includes(zdanie)) k.ostrzezenia.push(zdanie);
  }
  /* Brak stanu stoi za zerem: „nie wiemy" nie jest lepsze od „nie ma". */
  const stan = (k: KandydatDoboru) => k.stan ?? Number.MIN_SAFE_INTEGER;
  const kandydaci = [...trafione.values()].sort((a, b) =>
    GRUPY.indexOf(a.grupa) - GRUPY.indexOf(b.grupa) || SILA[b.pewnosc] - SILA[a.pewnosc]
    || stan(b) - stan(a) || a.symbol.localeCompare(b.symbol));
  return { kandydaci, bezKartoteki, negatywne, brakuje, kotwice: [...kotwice.values()] };
}
