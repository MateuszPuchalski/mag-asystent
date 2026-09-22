import {
  KODY, POWODY_INNE, PEWNOSCI, czyAkcja, czyKategoria,
  type Akcja, type Kategoria, type Pewnosc, type PowodInne, type StatusDecyzji, type Zrodlo,
} from "./klasyfikacja-slownik.js";

/* ── Polityka nad odpowiedzią klasyfikatora ──────────────────────────────────

   CZYSTE FUNKCJE, bez bazy i bez sieci. Model PROPONUJE, a ten plik
   rozstrzyga, co z tej propozycji zostaje decyzją. Specyfikacja rozdziela te
   dwie rzeczy wprost: surowa odpowiedź modelu i „znormalizowana decyzja
   polityki" leżą obok siebie, żeby każde nadpisanie dało się odtworzyć.

   Reguł jest mało i to jest decyzja. Każda reguła spójności, której model
   nie zna, zamienia poprawne odpowiedzi w „do przejrzenia". Stoją tu tylko
   te, których złamanie znaczy sprzeczność, a nie odmienny osąd.            */

/** Odpowiedź klasyfikatora PO walidacji — każde pole ma wartość ze słownika. */
export interface OdpowiedzKlasyfikatora {
  kategoria: Kategoria;
  dodatkowe: Kategoria[];
  akcja: Akcja;
  wymagaCzlowieka: boolean;
  /** Klient WPROST prosi o człowieka. Osobne pole, bo ta reguła nie ma wyjątku. */
  prosiOCzlowieka: boolean;
  brakDanychZamowienia: boolean;
  brakDanychProduktu: boolean;
  pewnosc: Pewnosc;
  powodInne: PowodInne | null;
  uzasadnienie: string;
}

/** Decyzja gotowa do zapisu — to, co widzi kolejka i co mierzy pomiar. */
export interface Decyzja {
  zrodlo: Zrodlo;
  status: StatusDecyzji;
  kategoria: Kategoria;
  dodatkowe: Kategoria[];
  kategoriaModelu: Kategoria | null;
  kategoriaAllegro: Kategoria | null;
  akcja: Akcja;
  akcjaModelu: Akcja | null;
  wymagaCzlowieka: boolean;
  brakDanychZamowienia: boolean;
  brakDanychProduktu: boolean;
  pewnosc: Pewnosc | null;
  uzasadnienie: string | null;
  kody: string[];
}

/**
 * Wskazówka ze struktury Allegro (typ i podtyp wątku). `waska` znaczy, że
 * mapowanie samo rozstrzyga kategorię; szeroka tylko podpowiada.
 */
export interface WskazowkaAllegro {
  kategoria: Kategoria;
  waska: boolean;
}

/** Ile kategorii dodatkowych przyjmujemy. Więcej to już nie „dodatkowe", tylko szum. */
const MAKS_DODATKOWYCH = 3;

/**
 * Walidacja surowej odpowiedzi. Wyjście strukturalne dostawcy pilnuje kształtu,
 * ale specyfikacja każe sprawdzić enumy i spójność PO NASZEJ stronie (AC3):
 * inny dostawca, odmowa albo ucięcie dadzą odpowiedź, której schemat nie
 * obronił. Zwraca zdanie zamiast rzucać — błąd walidacji to decyzja FAILED,
 * nie wywrotka partii.
 */
export function walidujOdpowiedz(
  s: unknown,
): { ok: true; odp: OdpowiedzKlasyfikatora } | { ok: false; powod: string } {
  if (!s || typeof s !== "object") return { ok: false, powod: "odpowiedź nie jest obiektem" };
  const o = s as Record<string, unknown>;
  if (!czyKategoria(o.kategoria)) {
    return { ok: false, powod: `kategoria spoza słownika: ${String(o.kategoria)}` };
  }
  if (!czyAkcja(o.akcja)) return { ok: false, powod: `akcja spoza słownika: ${String(o.akcja)}` };
  if (!Array.isArray(o.dodatkowe) || !o.dodatkowe.every(czyKategoria)) {
    return { ok: false, powod: "kategorie dodatkowe spoza słownika" };
  }
  for (const pole of ["wymagaCzlowieka", "prosiOCzlowieka", "brakDanychZamowienia", "brakDanychProduktu"]) {
    if (typeof o[pole] !== "boolean") return { ok: false, powod: `pole ${pole} nie jest prawdą/fałszem` };
  }
  if (!(PEWNOSCI as readonly string[]).includes(String(o.pewnosc))) {
    return { ok: false, powod: `pewność spoza słownika: ${String(o.pewnosc)}` };
  }
  const powodInne = o.powodInne === null || o.powodInne === undefined ? null : String(o.powodInne);
  if (powodInne !== null && !(POWODY_INNE as readonly string[]).includes(powodInne)) {
    return { ok: false, powod: `powód „inne" spoza słownika: ${powodInne}` };
  }
  /* Dodatkowe bez głównej i bez powtórzeń. Model powtarzający główną
     w dodatkowych nie jest niespójny, tylko rozwlekły — to się czyści. */
  const dodatkowe = [...new Set(o.dodatkowe as Kategoria[])]
    .filter((k) => k !== o.kategoria).slice(0, MAKS_DODATKOWYCH);
  return {
    ok: true,
    odp: {
      kategoria: o.kategoria, dodatkowe, akcja: o.akcja,
      wymagaCzlowieka: o.wymagaCzlowieka as boolean,
      prosiOCzlowieka: o.prosiOCzlowieka as boolean,
      brakDanychZamowienia: o.brakDanychZamowienia as boolean,
      brakDanychProduktu: o.brakDanychProduktu as boolean,
      pewnosc: o.pewnosc as Pewnosc,
      powodInne: powodInne as PowodInne | null,
      uzasadnienie: typeof o.uzasadnienie === "string" ? o.uzasadnienie.slice(0, 300) : "",
    },
  };
}

/*
 * Kategorie, przy których dana akcja ma sens. Poza nimi odpowiedź jest
 * SPRZECZNA SAMA W SOBIE: sprawdzanie pasowania przy fakturze albo
 * reklamacja przy pytaniu o termin. Lista jest celowo szeroka — reguła ma
 * łapać sprzeczność, a nie karać model za inny osąd niż nasz.
 */
const AKCJA_PRZY: Partial<Record<Akcja, readonly Kategoria[]>> = {
  CHECK_COMPATIBILITY: ["PRODUCT_COMPATIBILITY", "WRONG_PRODUCT", "PRODUCT_QUESTION"],
  START_COMPLAINT: ["COMPLAINT", "DAMAGED_PRODUCT", "DELIVERY_DAMAGED", "WRONG_PRODUCT", "MISSING_PRODUCT"],
  START_RETURN: ["RETURN", "WRONG_PRODUCT", "PRODUCT_COMPATIBILITY", "DAMAGED_PRODUCT",
    "DELIVERY_DAMAGED", "MISSING_PRODUCT"],
};

/** Czy odpowiedź przeczy sama sobie. Zwraca zdanie albo `null`. */
export function sprzecznosc(o: OdpowiedzKlasyfikatora): string | null {
  if (o.akcja === "NO_ACTION" && (o.wymagaCzlowieka || o.prosiOCzlowieka)) {
    return "„brak działania” przy sprawie, która wymaga człowieka";
  }
  const dozwolone = AKCJA_PRZY[o.akcja];
  if (dozwolone && !dozwolone.includes(o.kategoria)) {
    return `akcja ${o.akcja} nie pasuje do kategorii ${o.kategoria}`;
  }
  return null;
}

/**
 * Decyzja z odpowiedzi modelu.
 *
 * `wymagaCzlowieka` to specyfikacyjne `needsHuman`: model OR jawna prośba
 * klienta OR ryzyko polityki OR niepewność OR awaria. Każdy składnik dokłada
 * swój kod, więc ekran i pomiar wiedzą, KTÓRY z nich zadziałał.
 *
 * Status mówi o KLASYFIKACJI, nie o sprawie. Klient proszący o człowieka jest
 * rozpoznany dobrze (SUCCESS) i wymaga człowieka; niska pewność albo
 * sprzeczność znaczą, że samo rozpoznanie jest do przejrzenia (NEEDS_REVIEW).
 */
export function decyzjaZModelu(
  o: OdpowiedzKlasyfikatora, wskazowka: WskazowkaAllegro | null = null,
): Decyzja {
  const kody: string[] = [];
  let akcja: Akcja = o.akcja;
  let doPrzejrzenia = false;
  let wymaga = o.wymagaCzlowieka;
  if (o.wymagaCzlowieka) kody.push(KODY.modelZadaCzlowieka);

  /* Prośba o człowieka jest eskalowana ZAWSZE — specyfikacja nie zna tu
     progu. Akcja modelu zostaje w `akcjaModelu`, efektywna to przegląd. */
  if (o.prosiOCzlowieka) {
    wymaga = true;
    akcja = "HUMAN_REVIEW";
    kody.push(KODY.prosbaOCzlowieka);
  }
  if (o.pewnosc === "niska") {
    wymaga = true;
    doPrzejrzenia = true;
    kody.push(KODY.niskaPewnosc);
  }
  /* `OTHER` z „brakiem działania" to podziękowanie albo potwierdzenie — akcja
     jest jasna, człowiek nie jest potrzebny. `OTHER` z czymkolwiek innym
     znaczy „rozumiem, że czegoś chce, ale nie wiem czego" — i to jest
     dokładnie przypadek, dla którego specyfikacja każe wołać człowieka. */
  if (o.kategoria === "OTHER" && o.akcja !== "NO_ACTION") {
    wymaga = true;
    doPrzejrzenia = true;
    kody.push(KODY.kategoriaInne);
  }
  const sprzeczna = sprzecznosc(o);
  if (sprzeczna) {
    wymaga = true;
    doPrzejrzenia = true;
    akcja = "HUMAN_REVIEW";
    kody.push(KODY.niespojna);
  }
  /* Zwrot i reklamacja zostają RĘCZNE w całym tym wydaniu (specyfikacja:
     „START_RETURN and START_COMPLAINT remain manual"). Kod mówi agentowi,
     że to jego ruch, nie przeoczenie automatu. */
  if (o.akcja === "START_RETURN" || o.akcja === "START_COMPLAINT") {
    wymaga = true;
    kody.push(KODY.akcjaReczna);
  }
  /* Szeroka wskazówka Allegro, z którą model się nie zgadza, to spór dwóch
     źródeł — rozstrzyga człowiek. Zgoda niczego nie dokłada. */
  if (wskazowka && wskazowka.kategoria !== o.kategoria && !o.dodatkowe.includes(wskazowka.kategoria)) {
    wymaga = true;
    doPrzejrzenia = true;
    kody.push(KODY.sporZAllegro);
  }

  return {
    zrodlo: "MODEL",
    status: doPrzejrzenia ? "NEEDS_REVIEW" : "SUCCESS",
    kategoria: o.kategoria,
    dodatkowe: o.dodatkowe,
    kategoriaModelu: o.kategoria,
    kategoriaAllegro: wskazowka?.kategoria ?? null,
    akcja,
    akcjaModelu: o.akcja,
    wymagaCzlowieka: wymaga,
    brakDanychZamowienia: o.brakDanychZamowienia,
    brakDanychProduktu: o.brakDanychProduktu,
    pewnosc: o.pewnosc,
    uzasadnienie: o.uzasadnienie || null,
    kody,
  };
}

/**
 * Decyzja bez modelu: awaria, maskowanie albo sam załącznik.
 *
 * Specyfikacja: „Model failure uses OTHER plus an explicit failure status"
 * i „never drop an incoming case". Rozmowa dostaje więc wiersz, który mówi
 * wprost, że nikt jej nie rozpoznał — i dlatego trafia do człowieka.
 *
 * Flagi braku danych stoją na PRAWDZIE, bo tak każe specyfikacja przy
 * niepewności: zachowawczo znaczy „zakładam, że dane są potrzebne".
 */
export function decyzjaZastepcza(
  kod: string, status: "FAILED" | "NEEDS_REVIEW",
  wskazowka: WskazowkaAllegro | null = null,
): Decyzja {
  return {
    zrodlo: "FALLBACK",
    status,
    kategoria: "OTHER",
    dodatkowe: [],
    kategoriaModelu: null,
    kategoriaAllegro: wskazowka?.kategoria ?? null,
    akcja: "HUMAN_REVIEW",
    akcjaModelu: null,
    wymagaCzlowieka: true,
    brakDanychZamowienia: true,
    brakDanychProduktu: true,
    pewnosc: null,
    uzasadnienie: null,
    kody: [kod],
  };
}
