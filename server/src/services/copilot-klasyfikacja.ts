import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import {
  polacz, zamaskujBlok, zamaskujWatekZeSladem, zostalyDaneOsobowe, type TrescBezpieczna,
} from "./copilot-maskowanie.js";
import { kosztUsd, type Tokeny } from "./copilot-koszt.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladPrzeciazeniaCopilota,
} from "../adapters/copilot.js";
import {
  KATEGORIE, KODY, POLITYKA_WERSJA, TAKSONOMIA_WERSJA, TRYB, czyKategoria,
  type Kategoria, type Zrodlo,
} from "./klasyfikacja-slownik.js";
import {
  decyzjaZModelu, decyzjaZastepcza, walidujOdpowiedz, type Decyzja,
} from "./klasyfikacja-polityka.js";
import { MAPOWANIE_WERSJA, mapujStrukture, type WynikMapowania } from "./klasyfikacja-mapowanie.js";

export { KATEGORIE, PEWNOSCI, AKCJE } from "./klasyfikacja-slownik.js";
export type { Kategoria, Pewnosc, Akcja } from "./klasyfikacja-slownik.js";

/* ── Klasyfikacja wiadomości klienta (specyfikacja z 20 września 2026) ───────

   Druga wersja przyrostu z 0.191.0. Tamta brała JEDNĄ wiadomość, dawała
   jedną z ośmiu etykiet i nadpisywała poprzednią. Ta daje decyzję
   w kształcie specyfikacji: kategoria z piętnastu, kategorie dodatkowe,
   następny krok, trzy flagi potrzeb i kody reguł, które coś zmieniły.

   Cztery ostrożności z 0.191.0 zostają bez zmian:

   PIERWSZA: nic nie wychodzi niezamaskowane. Nadawca przyjmuje
   `TrescBezpieczna`, a przed siecią stoi asercja `zostalyDaneOsobowe()`.
   Kontekst jest teraz WĄTKIEM (ta sama droga i ten sam sufit co szkic),
   bo „tak, ten model" bez pytania, na które odpowiada, jest nie do
   rozpoznania — dokładnie ten przypadek specyfikacja wymienia z nazwy.

   DRUGA: automat NIE DECYDUJE o sprawie. Decyzja nie dotyka statusu
   rozmowy, priorytetu ani `conversation.version`. „Następny krok" jest
   podpowiedzią, nie pozwoleniem — żadna akcja z listy nie wykonuje się sama.

   TRZECIA: każda rozmowa to WŁASNA transakcja, partia leci sekwencyjnie.

   CZWARTA: za tę samą treść nie płacimy dwa razy. Decyzja wisi przy
   WIADOMOŚCI; nowa wiadomość klienta dostaje nową decyzję, a stara zostaje.

   NOWE: decyzje się nie nadpisują. Każda zmiana — ponowne rozpoznanie albo
   poprawka człowieka — to NOWA WERSJA, a poprzednia gaśnie (`aktywna=0`).
   Specyfikacja żąda historii, a poprzednia tabela z `ON CONFLICT DO UPDATE`
   gubiła przy każdym dopisku klienta to, co model sądził wcześniej.        */

/**
 * Odpowiedź nadawcy, SUROWA. Walidacja stoi w polityce, nie w adapterze:
 * inny dostawca (Jev) wpina się tą samą drogą i przechodzi te same sita.
 */
export interface OdpowiedzModelu {
  surowa: unknown;
  model: string;
  /** Wersja instrukcji nadawcy — bez niej pomiar zlałby dwa różne klasyfikatory. */
  promptWersja: string;
  zuzycie: Tokeny;
  ms: number;
}

/**
 * Wysyłka do dostawcy. Wstrzykiwana, żeby test nie potrzebował ani sieci, ani
 * klucza. Przyjmuje `TrescBezpieczna`, nie `string`: bramka prywatności
 * postawiona w typie, a nie w dyscyplinie.
 */
export type NadawcaKlasyfikacji = (tresc: TrescBezpieczna) => Promise<OdpowiedzModelu>;

export interface WynikPartii {
  sklasyfikowane: number;
  /** Rozmowy, za które NIE zapłaciliśmy, i powód. */
  pominiete: Array<{ rozmowaId: number; powod: string }>;
  bledy: Array<{ rozmowaId: number; powod: string }>;
  /** Zdanie dla człowieka, gdy partia STANĘŁA. `null` = przeszła do końca. */
  przerwane: string | null;
  zuzycie: Tokeny & { kosztUsd: number };
}

/** Autor decyzji. `id: null` to automat — tak samo jak przy szkicu z taktu. */
export type Autor = { id: number | null; name: string };

/**
 * Wiadomość, którą się klasyfikuje: OSTATNIA przychodząca. Fragment SQL stoi
 * TU i jest wspólny z kolejką (`skrzynka.ts`). Do tej wersji oba miejsca
 * miały go przepisanego „co do znaku", a rozjazd dawał rozmowę wiecznie
 * nieaktualną, klasyfikowaną w kółko przy każdym kliknięciu. Wymaga aliasu `c`.
 */
export const CEL_KLASYFIKACJI = `(SELECT m.id FROM message m WHERE m.conversation_id=c.id
  AND m.direction='incoming' ORDER BY m.sent_at DESC, m.id DESC LIMIT 1)`;

/**
 * Aktywna decyzja rozmowy w bieżącym słowniku — ta, którą widzi kolejka.
 * Najnowsza po wiadomości: decyzja starszej wiadomości zostaje w historii,
 * ale kolejka pokazuje ją jako nieaktualną, dopóki nowsza nie powstanie.
 * Wymaga aliasu `c`.
 */
export const AKTYWNA_DECYZJA = `(SELECT k.id FROM decyzja_klasyfikacji k
  WHERE k.conversation_id=c.id AND k.aktywna=1 AND k.taksonomia_wersja='${TAKSONOMIA_WERSJA}'
  ORDER BY k.message_id DESC, k.id DESC LIMIT 1)`;

const pusty: Tokeny = { wej: 0, wyj: 0, cacheZapis: 0, cacheOdczyt: 0 };

type Cel = {
  id: number; subject: string | null; login: string | null;
  message_id: number | null; body: string | null; zalacznikow: number;
  decyzja_status: string | null;
  watek_typ: string | null; watek_podtyp: string | null; watek_zamowienia: string | null;
  struktura_at: string | null;
  /** Czy cel to PIERWSZA wiadomość klienta w wątku — reguła 2 rejestru mapowań. */
  pierwsza: number;
};

const CEL = `
  SELECT c.id, c.subject,
         t.interlocutor_login AS login,
         t.watek_typ, t.watek_podtyp, t.watek_zamowienia, t.struktura_at,
         (m.id = (SELECT p.id FROM message p WHERE p.conversation_id = c.id
                     AND p.direction = 'incoming' ORDER BY p.sent_at, p.id LIMIT 1)) AS pierwsza,
         m.id AS message_id, m.body,
         (SELECT COUNT(*) FROM message_attachment a WHERE a.message_id = m.id) AS zalacznikow,
         (SELECT k.status FROM decyzja_klasyfikacji k
            WHERE k.message_id = m.id AND k.aktywna = 1
              AND k.taksonomia_wersja = '${TAKSONOMIA_WERSJA}') AS decyzja_status
  FROM conversation c
  LEFT JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
  LEFT JOIN message m ON m.id = ${CEL_KLASYFIKACJI}
  WHERE c.id = ?`;

/** Zamówienia z `orders` wątku w `beta.v1`, gdy go czytaliśmy. */
const zamowieniaWatku = (cel: Cel): string[] => {
  try {
    const z = JSON.parse(cel.watek_zamowienia ?? "[]");
    return Array.isArray(z) ? z.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Czego model się dowiedział i skąd — zapisuje się przy decyzji (specyfikacja: audyt). */
interface Kontekst {
  tresc: TrescBezpieczna;
  wiadomosci: number[];
  uciety: boolean;
  zamowienia: string[];
  oferty: string[];
}

/**
 * Kontekst dla modelu: nagłówek z faktów systemu i zamaskowany wątek.
 *
 * Nagłówek piszemy MY i nie ma w nim niczego od klienta — dlatego przechodzi
 * bez maskowania, tą samą drogą co nagłówki faktów szkicu. Niesie to, czego
 * model nie wyczyta z treści: czy jest zamówienie, czy jest oferta i ile
 * załączników ma wiadomość. „Brakuje noża" przy rozmowie z zamówieniem
 * i bez niego to dwie różne sprawy.
 *
 * Autoodpowiedzi nie idą — to nasze „dziękujemy za kontakt", szum bez treści.
 */
function kontekstRozmowy(database: DatabaseSync, cel: Cel): Kontekst {
  const wiadomosci = database.prepare(`SELECT id, direction, body,
      related_object_type, related_object_id, related_order_id
    FROM message WHERE conversation_id=? AND auto_odpowiedz=0
    ORDER BY sent_at, id`).all(cel.id) as Array<{
      id: number; direction: string; body: string | null;
      related_object_type: string | null; related_object_id: string | null;
      related_order_id: string | null }>;

  const zamowienia = [...new Set([...wiadomosci.map((w) => w.related_order_id)
    .filter((x): x is string => !!x), ...zamowieniaWatku(cel)])];
  const oferty = [...new Set(wiadomosci
    .filter((w) => w.related_object_type === "OFFER" && w.related_object_id)
    .map((w) => String(w.related_object_id)))];

  /* Login z WĄTKU Allegro (0.232.1); temat zostaje zapasem dla rozmów bez
     wątku, bo temat bywa tytułem oferty z loginem w środku. */
  const login = String(cel.login ?? "").trim() || cel.subject;
  const slad = zamaskujWatekZeSladem(
    wiadomosci.map((w) => ({ odKlienta: w.direction === "incoming", tresc: String(w.body ?? "") })),
    login);
  const naglowek = [
    "DANE Z SYSTEMU (nie od klienta):",
    "- rozpoznajesz OSTATNIĄ wiadomość oznaczoną KLIENT; wcześniejsze są kontekstem",
    `- zamówienie powiązane z rozmową: ${zamowienia.length ? "tak" : "nie"}`,
    `- oferta powiązana z rozmową: ${oferty.length ? "tak" : "nie"}`,
    `- załączniki w rozpoznawanej wiadomości: ${cel.zalacznikow}`,
    /* Struktura Allegro idzie jako FAKT, także przy dopisku — reguła 2
       rejestru zabrania jej rozstrzygać za model, nie zabrania jej pokazać.
       Wartości to enumy Allegro, nie treść od klienta. */
    ...(cel.watek_typ ? [`- typ wątku Allegro: ${cel.watek_typ}; podtyp: ${cel.watek_podtyp ?? "brak"}`
      + `; ${cel.pierwsza ? "to pierwsza wiadomość klienta w wątku" : "to dopisek w istniejącym wątku"}`] : []),
    "WĄTEK:",
  ].join("\n");

  return {
    tresc: polacz(zamaskujBlok(naglowek, "", null), slad.tresc),
    wiadomosci: wiadomosci.slice(wiadomosci.length - slad.ile).map((w) => Number(w.id)),
    uciety: slad.uciety,
    zamowienia,
    oferty,
  };
}

/** Wszystko, co zapisuje się przy decyzji poza nią samą. */
interface Meta {
  kontekst: Kontekst | null;
  zalacznikow: number;
  model: string | null;
  promptWersja: string | null;
  surowa: unknown;
  /** Struktura wątku, na której stało mapowanie; `null` = nie czytaliśmy. */
  struktura: { typ: string | null; podtyp: string | null } | null;
}

/**
 * Zapis decyzji jako NOWEJ WERSJI. Poprzednia aktywna dla tej wiadomości
 * gaśnie w tej samej transakcji — indeks częściowy `ux_decyzja_aktywna`
 * i tak nie wpuściłby dwóch, ale kolejność gaszenie→wstawienie jest tu
 * jawna, zamiast liczyć na błąd klucza.
 *
 * Zdarzenie niesie IDENTYFIKATORY i kategorię, nigdy treści (§19).
 */
function zapiszDecyzje(
  database: DatabaseSync, rozmowaId: number, messageId: number, d: Decyzja, m: Meta,
  kto: Autor, teraz: Date, dodatkowo: () => void = () => {},
): number {
  const id = transaction(database, () => {
    const wersja = Number((database.prepare(
      "SELECT COALESCE(MAX(wersja),0)+1 AS w FROM decyzja_klasyfikacji WHERE message_id=?")
      .get(messageId) as { w: number }).w);
    const poprzednia = database.prepare(
      "SELECT id FROM decyzja_klasyfikacji WHERE message_id=? AND aktywna=1").get(messageId) as
      { id: number } | undefined;
    database.prepare("UPDATE decyzja_klasyfikacji SET aktywna=0 WHERE message_id=? AND aktywna=1")
      .run(messageId);
    const nowa = Number(database.prepare(`INSERT INTO decyzja_klasyfikacji
      (conversation_id,message_id,wersja,aktywna,zrodlo,status,kategoria,kategorie_dodatkowe,
       kategoria_allegro,kategoria_modelu,kategoria_czlowieka,akcja,akcja_modelu,
       wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,pewnosc,uzasadnienie,
       surowa_odpowiedz,kody_polityki,kontekst_wiadomosci,kontekst_hash,kontekst_uciety,
       zalacznikow,zamowienia,oferty,model,prompt_wersja,taksonomia_wersja,polityka_wersja,
       tryb,at,przez,przez_user_id,poprzednia_id,watek_typ,watek_podtyp,api_wersja,mapowanie_wersja)
      VALUES (?,?,?,1,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      rozmowaId, messageId, wersja, d.zrodlo, d.status, d.kategoria,
      JSON.stringify(d.dodatkowe), d.kategoriaAllegro, d.kategoriaModelu,
      d.akcja, d.akcjaModelu, Number(d.wymagaCzlowieka), Number(d.brakDanychZamowienia),
      Number(d.brakDanychProduktu), d.pewnosc, d.uzasadnienie,
      m.surowa === undefined ? null : JSON.stringify(m.surowa),
      JSON.stringify(d.kody), JSON.stringify(m.kontekst?.wiadomosci ?? []),
      m.kontekst ? createHash("sha256").update(String(m.kontekst.tresc)).digest("hex") : null,
      Number(m.kontekst?.uciety ?? false), m.zalacznikow,
      JSON.stringify(m.kontekst?.zamowienia ?? []), JSON.stringify(m.kontekst?.oferty ?? []),
      m.model, m.promptWersja, TAKSONOMIA_WERSJA, POLITYKA_WERSJA, TRYB,
      teraz.toISOString(), kto.name, kto.id, poprzednia?.id ?? null,
      m.struktura?.typ ?? null, m.struktura?.podtyp ?? null,
      /* Wersja API i rejestru TYLKO wtedy, gdy struktura z bety naprawdę była —
         inaczej decyzja udawałaby, że stała na mapowaniu, którego nie było. */
      m.struktura ? "beta.v1" : null, m.struktura ? MAPOWANIE_WERSJA : null).lastInsertRowid);
    dodatkowo();
    logEvent("copilot_klasyfikacja", kto.name, null, {
      conversationId: rozmowaId, decyzjaId: nowa, wersja, zrodlo: d.zrodlo, status: d.status,
      kategoria: d.kategoria, akcja: d.akcja, wymagaCzlowieka: d.wymagaCzlowieka,
      kody: d.kody, model: m.model,
    }, kto.id, database);
    return nowa;
  })();
  /* Po transakcji: zdarzenie, którego zapis się wycofał, kazałoby panelowi
     odświeżyć listę po nic. Takt klasyfikuje w tle, więc bez tego zdarzenia
     plakietka pojawiałaby się dopiero przy następnym ruchu w kolejce. */
  publishConversationEvent("classification.updated", rozmowaId, { decyzjaId: id });
  return id;
}

/**
 * Rozpoznanie dla podanych rozmów.
 *
 * Identyfikatory podaje ekran albo takt. `ponowNieudane` pozwala ekranowi
 * powtórzyć decyzję FAILED — to jest „explicit reclassification" ze
 * specyfikacji i tworzy nową wersję. Takt tego nie robi: awaria, która
 * nie była stanem dostawcy, powtórzyłaby się co przebieg na koszt firmy.
 */
export async function sklasyfikujRozmowy(
  database: DatabaseSync,
  rozmowyId: number[],
  kto: Autor,
  nadaj: NadawcaKlasyfikacji,
  teraz = new Date(),
  opcje: { ponowNieudane?: boolean } = {},
): Promise<WynikPartii> {
  const wynik: WynikPartii = {
    sklasyfikowane: 0, pominiete: [], bledy: [], przerwane: null,
    zuzycie: { ...pusty, kosztUsd: 0 },
  };

  for (const rozmowaId of rozmowyId) {
    const cel = database.prepare(CEL).get(rozmowaId) as Cel | undefined;
    if (!cel) {
      wynik.pominiete.push({ rozmowaId, powod: "nie ma takiej rozmowy" });
      continue;
    }
    if (!cel.message_id) {
      wynik.pominiete.push({ rozmowaId, powod: "brak wiadomości od klienta" });
      continue;
    }
    const messageId = Number(cel.message_id);
    if (cel.decyzja_status !== null
      && !(opcje.ponowNieudane && cel.decyzja_status === "FAILED")) {
      wynik.pominiete.push({ rozmowaId, powod: "już rozpoznana na tej wiadomości" });
      continue;
    }
    const zalacznikow = Number(cel.zalacznikow ?? 0);
    const struktura = cel.struktura_at ? { typ: cel.watek_typ, podtyp: cel.watek_podtyp } : null;
    const mapa: WynikMapowania = mapujStrukture({
      typ: struktura?.typ ?? null, podtyp: struktura?.podtyp ?? null,
      zZamowieniem: zamowieniaWatku(cel).length > 0,
    }, Boolean(Number(cel.pierwsza)));
    /* Nieznana wartość struktury idzie do przeglądu mapowań ZDARZENIEM —
       ta sama droga wzrostu, co przy kategorii spoza słownika. */
    const doPrzegladu = () => {
      if (mapa.nieznane) {
        logEvent("klasyfikacja_mapowanie_do_przegladu", kto.name, null,
          { conversationId: rozmowaId, wartosc: mapa.nieznane }, kto.id, database);
      }
    };
    const zKodami = (d: Decyzja): Decyzja =>
      mapa.kody.length ? { ...d, kody: [...d.kody, ...mapa.kody] } : d;

    /* WĄSKIE MAPOWANIE rozstrzyga bez modelu — i bez kosztu. Stoi PRZED
       sprawdzeniem treści: pierwsza wiadomość sprawy o brakujący element
       bywa samym zdjęciem, a podtyp mówi o niej wszystko, czego potrzeba. */
    if (mapa.waska) {
      zapiszDecyzje(database, rozmowaId, messageId, mapa.waska,
        { kontekst: null, zalacznikow, model: null, promptWersja: null, surowa: undefined, struktura },
        kto, teraz);
      wynik.sklasyfikowane += 1;
      continue;
    }
    if (!(cel.body ?? "").trim()) {
      /* SAM ZAŁĄCZNIK. Specyfikacja: „do not silently treat an attachment-only
         message as understood". Do dostawcy nie idzie nic — nie ma czego
         czytać, a zdjęć klasyfikacja nie interpretuje — ale rozmowa dostaje
         decyzję, która mówi to wprost i woła człowieka. */
      if (zalacznikow > 0) {
        zapiszDecyzje(database, rozmowaId, messageId,
          zKodami(decyzjaZastepcza(KODY.tylkoZalacznik, "NEEDS_REVIEW", mapa.wskazowka)),
          { kontekst: null, zalacznikow, model: null, promptWersja: null, surowa: undefined, struktura },
          kto, teraz, doPrzegladu);
        wynik.pominiete.push({ rozmowaId, powod: "sam załącznik — do przejrzenia przez człowieka" });
      } else {
        wynik.pominiete.push({ rozmowaId, powod: "brak wiadomości od klienta" });
      }
      continue;
    }

    const kontekst = kontekstRozmowy(database, cel);
    /* Asercja końcowa PRZED siecią. Te same wzorce właśnie maskowały, więc
       trafienie znaczy zepsute maskowanie, a nie fałszywy alarm. Rozmowa
       dostaje decyzję FAILED — zgubienie jej po cichu byłoby gorsze. */
    if (zostalyDaneOsobowe(String(kontekst.tresc))) {
      zapiszDecyzje(database, rozmowaId, messageId,
        zKodami(decyzjaZastepcza(KODY.bladMaskowania, "FAILED", mapa.wskazowka)),
        { kontekst: null, zalacznikow, model: null, promptWersja: null, surowa: undefined, struktura },
        kto, teraz, () => { zapiszBlad(database, rozmowaId, "maskowanie", kto, teraz); doPrzegladu(); });
      wynik.bledy.push({ rozmowaId, powod: "maskowanie nie oczyściło treści — nie wysyłam" });
      continue;
    }

    let odp: OdpowiedzModelu;
    try {
      odp = await nadaj(kontekst.tresc);
    } catch (e) {
      const powod = (e as Error).message;
      const slad = (e as { slad?: string }).slad || powod;
      /* CZTERY POWODY ZATRZYMUJĄ CAŁĄ PARTIĘ, bo opisują stan DOSTAWCY, nie
         tej rozmowy. Decyzji wtedy NIE ZAPISUJEMY: rozmowa ma wrócić do
         następnego przebiegu, a decyzja FAILED by ją stamtąd zdjęła. To jest
         „bounded retry" specyfikacji — ograniczony sufitem godzinowym. */
      if (e instanceof BladLimituCopilota) {
        zapiszBlad(database, rozmowaId, slad, kto, teraz);
        wynik.bledy.push({ rozmowaId, powod });
        const za = e.poIluMs ? ` Spróbuj za ${Math.ceil(e.poIluMs / 60000)} min.` : "";
        wynik.przerwane = `Dostawca poprosił o przerwę.${za}`;
        break;
      }
      if (e instanceof BladKluczaCopilota || e instanceof BladPrzeciazeniaCopilota
        || e instanceof BladLacznosciCopilota) {
        zapiszBlad(database, rozmowaId, slad, kto, teraz);
        wynik.bledy.push({ rozmowaId, powod });
        wynik.przerwane = e.message;
        break;
      }
      /* Reszta dotyczy TEJ rozmowy (odmowa, ucięcie). Specyfikacja: „for a
         failed call, preserve the error status and route to HUMAN_REVIEW". */
      zapiszDecyzje(database, rozmowaId, messageId,
        zKodami(decyzjaZastepcza(KODY.bladModelu, "FAILED", mapa.wskazowka)),
        { kontekst, zalacznikow, model: null, promptWersja: null, surowa: undefined, struktura },
        kto, teraz, () => { zapiszBlad(database, rozmowaId, slad, kto, teraz); doPrzegladu(); });
      wynik.bledy.push({ rozmowaId, powod });
      continue;
    }

    const w = walidujOdpowiedz(odp.surowa);
    if (!w.ok) {
      /* NIE zakładamy nowej kategorii. Zdarzenie z odrzuconą wartością jest
         mechanizmem wzrostu słownika, a wywołanie było płatne. */
      zapiszDecyzje(database, rozmowaId, messageId,
        zKodami(decyzjaZastepcza(KODY.niepoprawna, "FAILED", mapa.wskazowka)),
        { kontekst, zalacznikow, model: odp.model, promptWersja: odp.promptWersja, surowa: odp.surowa,
          struktura },
        kto, teraz, () => {
          doPrzegladu();
          zapiszWywolanie(database, rozmowaId, odp, "blad", w.powod, kto, teraz);
          logEvent("copilot_klasyfikacja_niepoprawna", kto.name, null,
            { conversationId: rozmowaId, powod: w.powod, model: odp.model }, kto.id, database);
        });
      wynik.bledy.push({ rozmowaId, powod: `model zwrócił odpowiedź spoza słownika (${w.powod})` });
      dolicz(wynik, odp);
      continue;
    }

    zapiszDecyzje(database, rozmowaId, messageId, zKodami(decyzjaZModelu(w.odp, mapa.wskazowka)),
      { kontekst, zalacznikow, model: odp.model, promptWersja: odp.promptWersja, surowa: odp.surowa,
        struktura },
      kto, teraz, () => { zapiszWywolanie(database, rozmowaId, odp, "ok", null, kto, teraz); doPrzegladu(); });
    wynik.sklasyfikowane += 1;
    dolicz(wynik, odp);
  }

  wynik.zuzycie.kosztUsd = Number(wynik.zuzycie.kosztUsd.toFixed(6));
  return wynik;
}

function dolicz(wynik: WynikPartii, odp: OdpowiedzModelu): void {
  wynik.zuzycie.wej += odp.zuzycie.wej;
  wynik.zuzycie.wyj += odp.zuzycie.wyj;
  wynik.zuzycie.cacheZapis += odp.zuzycie.cacheZapis;
  wynik.zuzycie.cacheOdczyt += odp.zuzycie.cacheOdczyt;
  wynik.zuzycie.kosztUsd += kosztUsd(odp.model, odp.zuzycie);
}

function zapiszWywolanie(
  database: DatabaseSync, rozmowaId: number, odp: OdpowiedzModelu,
  wynik: "ok" | "blad", blad: string | null, kto: Autor, teraz: Date,
): void {
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at)
    VALUES ('klasyfikacja',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rozmowaId, odp.model, odp.zuzycie.wej, odp.zuzycie.wyj,
      odp.zuzycie.cacheZapis, odp.zuzycie.cacheOdczyt, odp.ms, wynik,
      blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString());
}

/* Próba, która nie doszła do odpowiedzi, też bywa płatna — a przy braku
   wiersza w księdze ta część rachunku znika bez śladu. Tokenów nie znamy,
   więc idą zera; liczy się fakt i klasa błędu. */
function zapiszBlad(
  database: DatabaseSync, rozmowaId: number, powod: string, kto: Autor, teraz: Date,
): void {
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,wynik,blad,przez_user_id,at)
    VALUES ('klasyfikacja',?,'',?,?,?,?)`)
    .run(rozmowaId, "blad", powod.slice(0, 300), kto.id, teraz.toISOString());
}

/**
 * Poprawka człowieka: kategoria, którą agent JAWNIE potwierdził albo wskazał.
 *
 * Zastępuje werdykt „trafna/nietrafna" z 0.191.0. Tamten mówił, że model się
 * pomylił, ale nie mówił, JAK powinno być — więc z ocen nie dało się policzyć
 * czułości żadnej kategorii, a specyfikacja stawia ją obok precyzji.
 *
 * Poprawka to NOWA WERSJA decyzji: `kategoria_modelu` i surowa odpowiedź
 * przechodzą bez zmian, `kategoria_czlowieka` dostaje wskazanie, a kategoria
 * efektywna idzie za człowiekiem. Akcja i flagi zostają — agent poprawia
 * etykietę, a sprawę prowadzi i tak on.
 *
 * Specyfikacja: akceptacja szkicu NIE jest etykietą. Etykietą jest wyłącznie
 * to kliknięcie.
 */
export function poprawKlasyfikacje(
  database: DatabaseSync, conversationId: number, kategoria: string, powod: string | null,
  kto: { id: number; name: string }, teraz = new Date(),
): { kategoria: Kategoria; decyzjaId: number } {
  if (!czyKategoria(kategoria)) {
    throw new Error(`Nieznana kategoria: ${kategoria}. Dozwolone: ${KATEGORIE.join(", ")}.`);
  }
  const c = database.prepare(`SELECT d.* FROM conversation c
    JOIN decyzja_klasyfikacji d ON d.id = ${AKTYWNA_DECYZJA} WHERE c.id=?`)
    .get(conversationId) as Record<string, unknown> | undefined;
  if (!c) throw new Error("Ta rozmowa nie ma jeszcze rozpoznanej kategorii");
  /* Potwierdzenie tego, co już potwierdzone, niczego nie zmienia — i nie
     zapisuje. Podwójne kliknięcie nie ma prawa podwoić etykiety w pomiarze. */
  if (c.kategoria_czlowieka === kategoria) return { kategoria, decyzjaId: Number(c.id) };

  const messageId = Number(c.message_id);
  const id = transaction(database, () => {
    const wersja = Number((database.prepare(
      "SELECT COALESCE(MAX(wersja),0)+1 AS w FROM decyzja_klasyfikacji WHERE message_id=?")
      .get(messageId) as { w: number }).w);
    database.prepare("UPDATE decyzja_klasyfikacji SET aktywna=0 WHERE id=?").run(Number(c.id));
    const nowa = Number(database.prepare(`INSERT INTO decyzja_klasyfikacji
      (conversation_id,message_id,wersja,aktywna,zrodlo,status,kategoria,kategorie_dodatkowe,
       kategoria_allegro,kategoria_modelu,kategoria_czlowieka,akcja,akcja_modelu,
       wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,pewnosc,uzasadnienie,
       surowa_odpowiedz,kody_polityki,kontekst_wiadomosci,kontekst_hash,kontekst_uciety,
       zalacznikow,zamowienia,oferty,model,prompt_wersja,taksonomia_wersja,polityka_wersja,
       tryb,at,przez,przez_user_id,poprawka_powod,poprzednia_id,
       watek_typ,watek_podtyp,api_wersja,mapowanie_wersja)
      SELECT conversation_id,message_id,?,1,zrodlo,status,?,
       (SELECT json_group_array(value) FROM json_each(kategorie_dodatkowe) WHERE value <> ?),
       kategoria_allegro,kategoria_modelu,?,akcja,akcja_modelu,
       wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,pewnosc,uzasadnienie,
       surowa_odpowiedz,kody_polityki,kontekst_wiadomosci,kontekst_hash,kontekst_uciety,
       zalacznikow,zamowienia,oferty,model,prompt_wersja,taksonomia_wersja,polityka_wersja,
       tryb,?,?,?,?,id,watek_typ,watek_podtyp,api_wersja,mapowanie_wersja
      FROM decyzja_klasyfikacji WHERE id=?`).run(
      wersja, kategoria, kategoria, kategoria, teraz.toISOString(), kto.name, kto.id,
      powod?.trim().slice(0, 300) || null, Number(c.id)).lastInsertRowid);
    logEvent("copilot_korekta", kto.name, null, {
      conversationId, decyzjaId: nowa, poprzedniaId: Number(c.id),
      bylo: c.kategoria, jest: kategoria, model: c.kategoria_modelu,
    }, kto.id, database);
    return nowa;
  })();
  publishConversationEvent("classification.updated", conversationId, { decyzjaId: id });
  return { kategoria, decyzjaId: id };
}

/* ── Pomiar ──────────────────────────────────────────────────────────────── */

/** Udział z przedziałem Wilsona 95 %. `null` = nie było z czego liczyć. */
export interface Udzial { k: number; n: number; p: number; dolna: number; gorna: number }

/**
 * Przedział Wilsona zamiast gołego procentu, bo specyfikacja żąda przy każdej
 * klasie „counts and uncertainty intervals". Przy trzech etykietach 100 %
 * trafności to przedział 44–100 % — i dokładnie tyle ta liczba wtedy wie.
 */
export function wilson(k: number, n: number): Udzial | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = k / n;
  const mian = 1 + (z * z) / n;
  const srodek = (p + (z * z) / (2 * n)) / mian;
  const pol = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / mian;
  const r = (x: number) => Number(x.toFixed(3));
  return { k, n, p: r(p), dolna: r(Math.max(0, srodek - pol)), gorna: r(Math.min(1, srodek + pol)) };
}

export interface PomiarKlasyfikacji {
  taksonomia: string;
  /** Aktywne decyzje bieżącego słownika. */
  decyzji: number;
  wgZrodla: Record<Zrodlo, number>;
  wgStatusu: Record<string, number>;
  wymagaCzlowieka: number;
  /** Decyzje modelu z etykietą człowieka — mianownik trafności. */
  oznaczonych: number;
  /** Decyzje modelu BEZ etykiety. Bez tej liczby każdy procent kłamie. */
  nieoznaczonych: number;
  /** Ile etykiet to POPRAWKI (człowiek wskazał co innego niż model). */
  poprawionych: number;
  wgKategorii: Array<{
    kategoria: Kategoria;
    przewidzianych: number;
    precyzja: Udzial | null;
    czulosc: Udzial | null;
  }>;
  /**
   * Zgodność mapowania struktury Allegro z etykietą człowieka — osobno od
   * modelu, bo specyfikacja każe mierzyć ją oddzielnie. Liczy decyzje ze
   * wskazaniem Allegro (wąskie i szerokie), przy których człowiek coś wskazał.
   */
  mapowanie: Udzial | null;
}

/**
 * Pomiar klasyfikacji — wyłącznie bieżący słownik, wyłącznie decyzje aktywne.
 *
 * Precyzja i czułość liczą się z decyzji MODELU z etykietą człowieka.
 * Próbka jest skrzywiona i ekran ma to mówić: agent częściej poprawia
 * pomyłkę, niż potwierdza trafienie, więc precyzja wychodzi tu raczej
 * zaniżona. Specyfikacja każe to równoważyć audytem próbki, nie wzorem.
 */
export function pomiarKlasyfikacji(database: DatabaseSync): PomiarKlasyfikacji {
  const wiersze = database.prepare(`SELECT zrodlo, status, wymaga_czlowieka,
      kategoria_modelu, kategoria_czlowieka, kategoria_allegro
    FROM decyzja_klasyfikacji WHERE aktywna=1 AND taksonomia_wersja=?`)
    .all(TAKSONOMIA_WERSJA) as Array<{
      zrodlo: Zrodlo; status: string; wymaga_czlowieka: number;
      kategoria_modelu: string | null; kategoria_czlowieka: string | null;
      kategoria_allegro: string | null }>;

  const wgZrodla: Record<Zrodlo, number> = { ALLEGRO_MAPPING: 0, MODEL: 0, FALLBACK: 0 };
  const wgStatusu: Record<string, number> = { SUCCESS: 0, FAILED: 0, NEEDS_REVIEW: 0 };
  let wymaga = 0;
  const oznaczone: Array<{ model: string; czlowiek: string }> = [];
  let nieoznaczonych = 0;
  for (const w of wiersze) {
    wgZrodla[w.zrodlo] = (wgZrodla[w.zrodlo] ?? 0) + 1;
    wgStatusu[w.status] = (wgStatusu[w.status] ?? 0) + 1;
    if (Number(w.wymaga_czlowieka)) wymaga++;
    if (w.zrodlo !== "MODEL" || !w.kategoria_modelu) continue;
    if (w.kategoria_czlowieka) oznaczone.push({ model: w.kategoria_modelu, czlowiek: w.kategoria_czlowieka });
    else nieoznaczonych++;
  }

  const przewidziane = new Map<string, number>();
  for (const w of wiersze) {
    if (w.zrodlo === "MODEL" && w.kategoria_modelu) {
      przewidziane.set(w.kategoria_modelu, (przewidziane.get(w.kategoria_modelu) ?? 0) + 1);
    }
  }
  const wgKategorii = KATEGORIE.map((kategoria) => {
    const trafne = oznaczone.filter((o) => o.model === kategoria && o.czlowiek === kategoria).length;
    return {
      kategoria,
      przewidzianych: przewidziane.get(kategoria) ?? 0,
      precyzja: wilson(trafne, oznaczone.filter((o) => o.model === kategoria).length),
      czulosc: wilson(trafne, oznaczone.filter((o) => o.czlowiek === kategoria).length),
    };
  }).filter((k) => k.przewidzianych > 0 || k.czulosc !== null);

  return {
    taksonomia: TAKSONOMIA_WERSJA,
    decyzji: wiersze.length, wgZrodla, wgStatusu, wymagaCzlowieka: wymaga,
    oznaczonych: oznaczone.length, nieoznaczonych,
    poprawionych: oznaczone.filter((o) => o.model !== o.czlowiek).length,
    wgKategorii,
    mapowanie: (() => {
      const zAllegro = wiersze.filter((w) => w.kategoria_allegro && w.kategoria_czlowieka);
      return wilson(zAllegro.filter((w) => w.kategoria_allegro === w.kategoria_czlowieka).length,
        zAllegro.length);
    })(),
  };
}

export interface PomiarCopilota {
  wywolan: number;
  bledow: number;
  tokeny: Tokeny;
  kosztUsd: number;
  /** Udział tokenów wejścia obsłużonych z cache. `null` = nie było czego liczyć. */
  udzialCache: number | null;
  /** Klasyfikacja w kształcie specyfikacji — precyzja i czułość per klasa. */
  klasyfikacja: PomiarKlasyfikacji;
  /**
   * Rozbicie księgi po ZADANIU (0.231.0). Bez tego koszt szkiców zlałby się
   * z miarą klasyfikacji i „zejdź na tańszy model" nie wiedziałoby, o którym
   * zadaniu mówi.
   */
  wgZadania: Array<{ zadanie: string; wywolan: number; bledow: number; kosztUsd: number }>;
  /**
   * Szkice odpowiedzi: ile powstało i co agent z nimi zrobił. Od przyrostu
   * trzeciego także los DANYCH z rozmowy — osobno, bo dobry szkic bywa ze
   * złym modelem i odwrotnie.
   */
  szkice: {
    /**
     * Ile szkiców powstało i ile agent ODRZUCIŁ. „Wstawionych" i „zastąpionych"
     * odeszły 22 września 2026: to był zastępnik losu przy wysyłce, a wstawiony
     * szkic bywał potem przepisany. Los niosą `wyslanych*` niżej.
     */
    ile: number; odrzuconych: number;
    daneZaproponowane: number; daneWpisane: number; daneOdrzucone: number;
    /**
     * Pasowania z rozmowy (przyrost czwarty): ile model nazwał, co agent
     * kliknął i — właściwa miara jakości — ile z nich biuro ZATWIERDZIŁO.
     */
    pasowaniaRozpoznane: number; pasowaniaZaproponowane: number; pasowaniaOdrzucone: number;
    pasowaniaZatwierdzonePrzezBiuro: number;
    /**
     * Los szkicu PRZY WYSYŁCE (22 września 2026): ile odpowiedzi poszło ze
     * szkicu bez zmian, a ile z poprawką. Specyfikacja stawia to obok
     * odrzuceń — te niesie `odrzuconych` wyżej.
     */
    wyslanychBezZmian: number; wyslanychPoprawionych: number;
  };
}

/** Pomiar do ekranu ustawień. Czysty odczyt — nie zapisuje niczego. */
export function pomiarCopilota(database: DatabaseSync = defaultDb()): PomiarCopilota {
  const w = database.prepare(`SELECT
      COUNT(*) AS wywolan,
      SUM(CASE WHEN wynik='blad' THEN 1 ELSE 0 END) AS bledow,
      COALESCE(SUM(tokeny_wej),0) AS wej, COALESCE(SUM(tokeny_wyj),0) AS wyj,
      COALESCE(SUM(tokeny_cache_zapis),0) AS cacheZapis,
      COALESCE(SUM(tokeny_cache_odczyt),0) AS cacheOdczyt
    FROM copilot_wywolanie`).get() as Record<string, number>;

  const tokeny: Tokeny = {
    wej: Number(w.wej), wyj: Number(w.wyj),
    cacheZapis: Number(w.cacheZapis), cacheOdczyt: Number(w.cacheOdczyt),
  };
  /* Koszt liczymy po modelach, nie ryczałtem: partia sprzed zmiany modelu ma
     inną stawkę niż dzisiejsza. */
  const perModel = database.prepare(`SELECT model,
      COALESCE(SUM(tokeny_wej),0) AS wej, COALESCE(SUM(tokeny_wyj),0) AS wyj,
      COALESCE(SUM(tokeny_cache_zapis),0) AS cacheZapis,
      COALESCE(SUM(tokeny_cache_odczyt),0) AS cacheOdczyt
    FROM copilot_wywolanie WHERE model <> '' GROUP BY model`)
    .all() as Array<Record<string, string | number>>;
  const usd = perModel.reduce((suma, m) => suma + kosztUsd(String(m.model), {
    wej: Number(m.wej), wyj: Number(m.wyj),
    cacheZapis: Number(m.cacheZapis), cacheOdczyt: Number(m.cacheOdczyt),
  }), 0);

  const wgZadania = (database.prepare(`SELECT zadanie, model,
      COUNT(*) AS wywolan, SUM(CASE WHEN wynik='blad' THEN 1 ELSE 0 END) AS bledow,
      COALESCE(SUM(tokeny_wej),0) AS wej, COALESCE(SUM(tokeny_wyj),0) AS wyj,
      COALESCE(SUM(tokeny_cache_zapis),0) AS cacheZapis,
      COALESCE(SUM(tokeny_cache_odczyt),0) AS cacheOdczyt
    FROM copilot_wywolanie GROUP BY zadanie, model ORDER BY zadanie`)
    .all() as Array<Record<string, string | number>>)
    .reduce((acc, w) => {
      const z = acc.find((x) => x.zadanie === String(w.zadanie))
        ?? acc[acc.push({ zadanie: String(w.zadanie), wywolan: 0, bledow: 0, kosztUsd: 0 }) - 1]!;
      z.wywolan += Number(w.wywolan); z.bledow += Number(w.bledow ?? 0);
      if (String(w.model)) {
        z.kosztUsd = Number((z.kosztUsd + kosztUsd(String(w.model), {
          wej: Number(w.wej), wyj: Number(w.wyj),
          cacheZapis: Number(w.cacheZapis), cacheOdczyt: Number(w.cacheOdczyt),
        })).toFixed(6));
      }
      return acc;
    }, [] as PomiarCopilota["wgZadania"]);

  const sz = database.prepare(`SELECT COUNT(*) AS ile,
      SUM(CASE WHEN ocena='odrzucony' THEN 1 ELSE 0 END) AS odrzuconych,
      SUM(CASE WHEN dane_doboru IS NOT NULL THEN 1 ELSE 0 END) AS daneZaproponowane,
      SUM(CASE WHEN dane_ocena='wpisane' THEN 1 ELSE 0 END) AS daneWpisane,
      SUM(CASE WHEN dane_ocena='odrzucone' THEN 1 ELSE 0 END) AS daneOdrzucone,
      SUM(CASE WHEN pasowanie_propozycja IS NOT NULL THEN 1 ELSE 0 END) AS pasowaniaRozpoznane,
      SUM(CASE WHEN pasowanie_ocena='zaproponowane' THEN 1 ELSE 0 END) AS pasowaniaZaproponowane,
      SUM(CASE WHEN pasowanie_ocena='odrzucone' THEN 1 ELSE 0 END) AS pasowaniaOdrzucone
    FROM szkic_copilota`).get() as Record<string, number>;
  const zatw = database.prepare(`SELECT COUNT(*) AS n FROM pasowanie_czesci
    WHERE zrodlo_propozycji='copilot' AND stan='zatwierdzone'`).get() as { n: number };
  const wys = database.prepare(`SELECT
      SUM(CASE WHEN szkic_los='bez_zmian' THEN 1 ELSE 0 END) AS bez,
      SUM(CASE WHEN szkic_los='poprawiony' THEN 1 ELSE 0 END) AS popr
    FROM outbox WHERE status='sent'`).get() as { bez: number | null; popr: number | null };

  const wejscieRazem = tokeny.wej + tokeny.cacheOdczyt;
  return {
    wywolan: Number(w.wywolan), bledow: Number(w.bledow ?? 0),
    tokeny, kosztUsd: Number(usd.toFixed(6)),
    udzialCache: wejscieRazem > 0
      ? Number((tokeny.cacheOdczyt / wejscieRazem).toFixed(2)) : null,
    klasyfikacja: pomiarKlasyfikacji(database),
    wgZadania,
    szkice: {
      ile: Number(sz.ile ?? 0), odrzuconych: Number(sz.odrzuconych ?? 0),
      daneZaproponowane: Number(sz.daneZaproponowane ?? 0),
      daneWpisane: Number(sz.daneWpisane ?? 0), daneOdrzucone: Number(sz.daneOdrzucone ?? 0),
      pasowaniaRozpoznane: Number(sz.pasowaniaRozpoznane ?? 0),
      pasowaniaZaproponowane: Number(sz.pasowaniaZaproponowane ?? 0),
      pasowaniaOdrzucone: Number(sz.pasowaniaOdrzucone ?? 0),
      pasowaniaZatwierdzonePrzezBiuro: Number(zatw.n ?? 0),
      wyslanychBezZmian: Number(wys.bez ?? 0), wyslanychPoprawionych: Number(wys.popr ?? 0),
    },
  };
}
