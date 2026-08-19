import { db, nowIso, transaction } from "../db/db.js";
import {
  allegroAdapter,
  type SzukanieWatku,
  type ZwrotAllegro,
} from "../adapters/allegro.js";
import { logEvent } from "./events.js";

/* ── Zwroty Allegro — serwis (Etap 1) ────────────────────────────────────────
   Skan etykiety → rekord zwrotu z danymi z Allegro → decyzje pracownika per
   pozycja → automatyczne dopasowanie dokumentu sprzedaży (FS/PA) z Subiekta.
   Zwrot środków jest półautomatyczny: link do panelu + stempel ręką.

   Etap 1 NICZEGO nie zapisuje do Subiekta. Korekta i MM na magazyn zwrotów
   to Etap 2 — dlatego status jest otwartym słownikiem (patrz schema.sql).

   DECYZJA JEST PER POZYCJA, nie per zwrot: jedna paczka miewa artykuł
   pełnowartościowy i uszkodzony naraz, a decyzja per paczka wymuszałaby
   najgorszy wspólny mianownik. Status zwrotu jest POCHODNĄ decyzji.          */

export const DECYZJE = [
  "pelnowartosciowy",
  "reklamacja",
  "do_wyjasnienia",
  "do_zniszczenia",
] as const;
export type Decyzja = (typeof DECYZJE)[number];

/** Panel zwrotów sprzedawcy. Link per zwrot jest [WERYFIKUJ] — lista + numer
    referencyjny wystarczą pracownikowi niezależnie od redesignów Allegro. */
export const LINK_PANELU_ZWROTOW = "https://salescenter.allegro.com/returns";

/** Okno szukania dokumentu względem daty zwrotu [dni]. */
const OKNO_DOPASOWANIA_DNI = 120;
/** Punktacja od tego progu w górę, przy DOKŁADNIE jednym kandydacie = auto. */
const PROG_AUTO = 100;
/** Ilu kandydatów najwyżej pokazujemy do ręcznego wyboru. */
const LIMIT_KANDYDATOW = 10;

// ── Typy odpowiedzi ─────────────────────────────────────────────────────────

export interface PozycjaZwrotu {
  id: number;
  offerId: string | null;
  nazwa: string;
  externalId: string | null;
  twId: number | null;
  symbol: string | null;
  ilosc: number;
  powod: string | null;
  powodOpis: string | null;
  decyzja: string | null;
  decyzjaAt: string | null;
  decyzjaPrzez: string | null;
  notatka: string | null;
}

export interface PozycjaZamowienia {
  offerId: string | null;
  nazwa: string;
  externalId: string | null;
  twId: number | null;
  symbol: string | null;
  ilosc: number;
  /** Czy TA pozycja wraca w zwrocie — reszta została u klienta. */
  zwracana: boolean;
}

export interface KandydatDokumentu {
  dokId: number;
  numer: string;
  typ: string;
  data: string;
  kontrahent: string | null;
  punkty: number;
  /** DLACZEGO tyle punktów — biuro wybiera ręcznie, więc ma widzieć powody. */
  powody: string[];
}

export interface SzczegolZwrotu {
  id: number;
  allegroReturnId: string | null;
  allegroOrderId: string | null;
  referencja: string | null;
  waybill: string;
  status: string;
  statusAllegro: string | null;
  kupujacyLogin: string | null;
  /** Identyfikator kupującego — po nim znajduje się wątek wiadomości. */
  kupujacyId: string | null;
  kupujacyEmail: string | null;
  utworzonoAllegro: string | null;
  utworzonoAt: string;
  utworzonoPrzez: string;
  dokument: { dokId: number; numer: string | null; typ: string | null; dopasowanie: string } | null;
  zwrotSrodkow: { at: string; przez: string } | null;
  linkPanel: string;
  pozycje: PozycjaZwrotu[];
  /** Całe zamówienie ze snapshotu; puste przy zwrocie ręcznym. */
  pozycjeZamowienia: PozycjaZamowienia[];
  /** Tylko gdy dopasowanie='brak' — posortowani malejąco po punktach. */
  kandydaciDokumentu?: KandydatDokumentu[];
}

export type WynikSkanu =
  | { rodzaj: "utworzony"; zwrot: SzczegolZwrotu }
  | { rodzaj: "istniejacy"; zwrot: SzczegolZwrotu }
  | {
      rodzaj: "kandydaci";
      kandydaci: Array<{ id: string; referencja: string | null; kupujacyLogin: string | null; utworzono: string | null; pozycji: number }>;
    }
  | { rodzaj: "brak" };

interface WierszZwrotu {
  id: number;
  allegro_return_id: string | null;
  allegro_order_id: string | null;
  referencja: string | null;
  waybill: string;
  status: string;
  status_allegro: string | null;
  kupujacy_login: string | null;
  kupujacy_id: string | null;
  kupujacy_email: string | null;
  utworzono_allegro: string | null;
  utworzono_at: string;
  utworzono_przez: string;
  sgt_dok_id: number | null;
  sgt_dok_numer: string | null;
  sgt_dok_typ: string | null;
  dopasowanie: string;
  zwrot_srodkow_at: string | null;
  zwrot_srodkow_przez: string | null;
}

// ── Utworzenie ze skanu ─────────────────────────────────────────────────────

/**
 * Skan etykiety zwrotnej. Normalizacja to samo przycięcie białych znaków —
 * BEZ upper-case: wielkość liter w numerach przewoźników nie jest nasza do
 * poprawiania, zapisujemy to, co zeskanowano.
 */
export async function utworzZeSkanu(kod: string, autor: string): Promise<WynikSkanu> {
  const waybill = kod.trim();
  if (!waybill) throw new BladZwrotu(400, "Pusty kod — zeskanuj etykietę zwrotu");

  /* Idempotencja skanu: druga osoba skanująca tę samą paczkę dostaje
     ISTNIEJĄCY zwrot, nie duplikat i nie błąd. */
  const znany = db()
    .prepare("SELECT id FROM zwrot WHERE waybill = ? ORDER BY id LIMIT 1")
    .get(waybill) as { id: number } | undefined;
  if (znany) return { rodzaj: "istniejacy", zwrot: szczegolZwrotu(znany.id) };

  const znalezione = await allegroAdapter().szukajZwrotowPoWaybill(waybill);
  if (znalezione.length === 0) return { rodzaj: "brak" };
  if (znalezione.length > 1) {
    /* Jeden numer na kilku zwrotach zdarza się przy paczkach łączonych —
       rozstrzyga człowiek, my pokazujemy z czego wybiera. */
    return {
      rodzaj: "kandydaci",
      kandydaci: znalezione.map((z) => ({
        id: z.id,
        referencja: z.referencja,
        kupujacyLogin: z.kupujacyLogin,
        utworzono: z.utworzono,
        pozycji: z.pozycje.length,
      })),
    };
  }
  /* Lista zwrotów jest STRESZCZENIEM: powody zwrotu i komentarze kupującego
     niesie dopiero szczegół pojedynczego zwrotu. Bez tego dociągnięcia karta
     miała kolumnę POWÓD pustą przy każdym prawdziwym zwrocie (0.56.5).
     Nieudany szczegół degraduje do danych z listy — zwrot ma powstać. */
  const pelny = (await allegroAdapter().zwrot(znalezione[0].id)) ?? znalezione[0];
  const zwrot = await utworzZAllegro(pelny, waybill, autor);
  return { rodzaj: "utworzony", zwrot };
}

/** Wybór z listy kandydatów po skanie niejednoznacznym. */
export async function utworzZAllegroId(
  allegroId: string,
  waybill: string,
  autor: string
): Promise<SzczegolZwrotu> {
  const istnieje = db()
    .prepare("SELECT id FROM zwrot WHERE allegro_return_id = ?")
    .get(allegroId) as { id: number } | undefined;
  if (istnieje) return szczegolZwrotu(istnieje.id);
  const z = await allegroAdapter().zwrot(allegroId);
  if (!z) throw new BladZwrotu(404, `Allegro nie zna zwrotu ${allegroId}`);
  return utworzZAllegro(z, waybill.trim() || z.paczki[0]?.waybill || allegroId, autor);
}

/**
 * Zwrot ręczny — etykieta, której Allegro nie znało (zwrot poza systemem,
 * stara paczka, uszkodzony kod). Pozycje dopisuje biuro wskazując kartoteki;
 * dalej ta sama maszyna stanów.
 */
export function utworzReczny(waybill: string, autor: string): SzczegolZwrotu {
  const kod = waybill.trim();
  if (!kod) throw new BladZwrotu(400, "Pusty kod etykiety");
  const znany = db()
    .prepare("SELECT id FROM zwrot WHERE waybill = ? ORDER BY id LIMIT 1")
    .get(kod) as { id: number } | undefined;
  if (znany) return szczegolZwrotu(znany.id);
  const wynik = db()
    .prepare(
      `INSERT INTO zwrot(waybill, status, utworzono_at, utworzono_przez)
       VALUES (?, 'nowy', ?, ?)`
    )
    .run(kod, nowIso(), autor);
  const id = Number(wynik.lastInsertRowid);
  logEvent("zwrot_utworzony", autor, null, { zwrotId: id, waybill: kod, reczny: true });
  return szczegolZwrotu(id);
}

async function utworzZAllegro(
  z: ZwrotAllegro,
  waybill: string,
  autor: string
): Promise<SzczegolZwrotu> {
  /* Sygnatury pozycji (symbol kartoteki) niesie ZAMÓWIENIE, nie zwrot —
     dociągamy je po offerId. Brak zamówienia degraduje do pozycji bez
     dopasowania, nie do błędu: paczka i tak leży na biurku. */
  const zamowienie = z.orderId ? await allegroAdapter().zamowienie(z.orderId) : null;
  const sygnatury = new Map<string, string>();
  for (const p of zamowienie?.pozycje ?? []) {
    if (p.offerId && p.externalId) sygnatury.set(p.offerId, p.externalId);
  }

  const d = db();
  let id = 0;
  try {
    transaction(d, () => {
      const wynik = d
        .prepare(
          `INSERT INTO zwrot(allegro_return_id, allegro_order_id, referencja, waybill,
                             status_allegro, kupujacy_login, kupujacy_id, kupujacy_email,
                             utworzono_allegro,
                             status, surowe_json, utworzono_at, utworzono_przez)
           VALUES (?,?,?,?,?,?,?,?,?, 'nowy', ?,?,?)`
        )
        .run(
          z.id,
          z.orderId,
          z.referencja,
          waybill,
          z.status,
          z.kupujacyLogin ?? zamowienie?.kupujacyLogin ?? null,
          z.kupujacyId ?? zamowienie?.kupujacyId ?? null,
          z.kupujacyEmail ?? zamowienie?.kupujacyEmail ?? null,
          z.utworzono,
          JSON.stringify(z.surowe ?? null),
          nowIso(),
          autor
        );
      id = Number(wynik.lastInsertRowid);
      const insPoz = d.prepare(
        `INSERT INTO zwrot_pozycja(zwrot_id, offer_id, nazwa, external_id, tw_id, ilosc, powod, powod_opis)
         VALUES (?,?,?,?,?,?,?,?)`
      );
      for (const p of z.pozycje) {
        const externalId = p.externalId ?? (p.offerId ? (sygnatury.get(p.offerId) ?? null) : null);
        insPoz.run(
          id,
          p.offerId,
          p.nazwa,
          externalId,
          externalId ? dopasujKartoteke(externalId) : null,
          p.ilosc,
          p.powod,
          p.powodOpis
        );
      }

      /* CAŁE zamówienie, nie tylko to, co wraca. Biuro pyta „co klient
         zamawiał razem z tym" — czy odesłał komplet, czy jedną rzecz
         z zestawu. Zamówienie i tak już pobraliśmy po sygnatury, więc to
         zapis tego, co mamy w ręku, a nie dodatkowe zapytanie do Allegro. */
      const insZam = d.prepare(
        `INSERT INTO zwrot_zam_pozycja(zwrot_id, offer_id, nazwa, external_id, tw_id, ilosc)
         VALUES (?,?,?,?,?,?)`
      );
      for (const p of zamowienie?.pozycje ?? []) {
        insZam.run(
          id,
          p.offerId,
          p.nazwa,
          p.externalId,
          p.externalId ? dopasujKartoteke(p.externalId) : null,
          p.ilosc
        );
      }
    })();
  } catch (e) {
    /* Wyścig dwóch skanów tej samej paczki: UNIQUE na allegro_return_id.
       Przegrany wyścigu dostaje zwrot wygranego — dokładnie to, czego chciał. */
    if (e instanceof Error && /UNIQUE/.test(e.message)) {
      const w = d
        .prepare("SELECT id FROM zwrot WHERE allegro_return_id = ?")
        .get(z.id) as { id: number } | undefined;
      if (w) return szczegolZwrotu(w.id);
    }
    throw e;
  }

  dopasujDokument(id, autor);
  logEvent("zwrot_utworzony", autor, null, {
    zwrotId: id,
    waybill,
    allegroReturnId: z.id,
    pozycji: z.pozycje.length,
  });
  return szczegolZwrotu(id);
}

/**
 * Kartoteka dla sygnatury sprzedawcy: symbol (bez wielkości liter), zapasowo
 * EAN, uczciwe NULL gdy nic. Ta sama kolejność co import zbiórek.
 */
export function dopasujKartoteke(externalId: string): number | null {
  const d = db();
  const poSymbolu = d
    .prepare("SELECT tw_id FROM sgt_towar WHERE symbol = ? COLLATE NOCASE LIMIT 1")
    .get(externalId) as { tw_id: number } | undefined;
  if (poSymbolu) return poSymbolu.tw_id;
  if (/^\d{8,14}$/.test(externalId)) {
    const poEan = d
      .prepare("SELECT tw_id FROM sgt_towar WHERE ean = ? LIMIT 1")
      .get(externalId) as { tw_id: number } | undefined;
    if (poEan) return poEan.tw_id;
  }
  return null;
}

// ── Dopasowanie dokumentu sprzedaży ─────────────────────────────────────────

/**
 * Kandydaci z punktacją. Sygnał rozstrzygający (+100) to numer zamówienia
 * Allegro w numerze obcym albo uwagach dokumentu — jeśli integracja go tam
 * wpisuje ([WERYFIKUJ]). Reszta to poszlaki: nakładka pozycji, kontrahent,
 * bliskość daty. Wynik jest jawny per kandydat, bo przy wyborze ręcznym
 * pracownik ma widzieć, DLACZEGO aplikacja coś proponuje.
 */
export function kandydaciDokumentu(zwrotId: number): KandydatDokumentu[] {
  const d = db();
  const z = d
    .prepare(
      "SELECT allegro_order_id, referencja, kupujacy_login, utworzono_allegro FROM zwrot WHERE id = ?"
    )
    .get(zwrotId) as
    | { allegro_order_id: string | null; referencja: string | null; kupujacy_login: string | null; utworzono_allegro: string | null }
    | undefined;
  if (!z) return [];

  const koniec = (z.utworzono_allegro ?? nowIso()).slice(0, 10);
  const poczatek = new Date(Date.parse(koniec) - OKNO_DOPASOWANIA_DNI * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const dokumenty = d
    .prepare(
      `SELECT dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, uwagi
       FROM sgt_sprzedaz WHERE data_wyst >= ? AND data_wyst <= ?`
    )
    .all(poczatek, koniec) as Array<{
    dok_id: number; typ: string; nr_pelny: string; nr_oryg: string | null;
    data_wyst: string; kontrahent: string | null; uwagi: string | null;
  }>;
  if (dokumenty.length === 0) return [];

  const pozycjeZwrotu = d
    .prepare(
      "SELECT tw_id, SUM(ilosc) AS ilosc FROM zwrot_pozycja WHERE zwrot_id = ? AND tw_id IS NOT NULL GROUP BY tw_id"
    )
    .all(zwrotId) as Array<{ tw_id: number; ilosc: number }>;

  /* Pozycje wszystkich kandydatów jednym zapytaniem — okno ma 90 dni
     dokumentów, pojedyncze SELECT-y per dokument to setki zapytań na skan. */
  const pozycjeDokow = new Map<number, Map<number, number>>();
  if (pozycjeZwrotu.length) {
    const idList = dokumenty.map((k) => k.dok_id).join(",");
    const wiersze = d
      .prepare(
        `SELECT dok_id, tw_id, SUM(ilosc) AS ilosc FROM sgt_sprzedaz_pozycja
         WHERE dok_id IN (${idList}) GROUP BY dok_id, tw_id`
      )
      .all() as Array<{ dok_id: number; tw_id: number; ilosc: number }>;
    for (const w of wiersze) {
      let m = pozycjeDokow.get(w.dok_id);
      if (!m) pozycjeDokow.set(w.dok_id, (m = new Map()));
      m.set(w.tw_id, w.ilosc);
    }
  }

  const szukane = [z.allegro_order_id, z.referencja]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  const login = z.kupujacy_login?.toLowerCase() ?? null;

  const kandydaci: KandydatDokumentu[] = [];
  for (const dok of dokumenty) {
    let punkty = 0;
    const powody: string[] = [];

    const tekstDoku = `${dok.nr_oryg ?? ""}\n${dok.uwagi ?? ""}`.toLowerCase();
    if (szukane.some((s) => tekstDoku.includes(s))) {
      punkty += 100;
      powody.push("numer zamówienia Allegro na dokumencie");
    }

    if (pozycjeZwrotu.length) {
      const naDoku = pozycjeDokow.get(dok.dok_id);
      const wszystkie = pozycjeZwrotu.every(
        (p) => (naDoku?.get(p.tw_id) ?? 0) >= p.ilosc
      );
      if (wszystkie && naDoku) {
        punkty += 40;
        powody.push("wszystkie zwracane towary są na dokumencie");
      }
    }

    if (login && dok.kontrahent && dok.kontrahent.toLowerCase().includes(login)) {
      punkty += 10;
      powody.push("kontrahent pasuje do loginu kupującego");
    }

    /* Bliskość daty wyłącznie jako tie-breaker: 5 punktów świeżemu, po jednym
       mniej za każdy miesiąc — nigdy nie przeskoczy żadnego sygnału wyżej. */
    const dni = Math.max(0, (Date.parse(koniec) - Date.parse(dok.data_wyst)) / 86_400_000);
    punkty += Math.max(0, 5 - Math.floor(dni / 30));

    if (punkty > 0) {
      kandydaci.push({
        dokId: dok.dok_id,
        numer: dok.nr_pelny,
        typ: dok.typ,
        data: dok.data_wyst,
        kontrahent: dok.kontrahent,
        punkty,
        powody,
      });
    }
  }
  kandydaci.sort((a, b) => b.punkty - a.punkty || b.data.localeCompare(a.data));
  return kandydaci.slice(0, LIMIT_KANDYDATOW);
}

/**
 * Automatyczne dopasowanie przy utworzeniu: DOKŁADNIE jeden kandydat z progiem
 * `PROG_AUTO` → link. Dwóch mocnych albo żaden — zostaje `brak` i lista
 * kandydatów w szczególe; fałszywe auto-dopasowanie kosztowałoby korektę do
 * cudzego dokumentu w Etapie 2, więc próg jest świadomie wysoki.
 */
export function dopasujDokument(zwrotId: number, autor: string): void {
  const kandydaci = kandydaciDokumentu(zwrotId);
  const mocni = kandydaci.filter((k) => k.punkty >= PROG_AUTO);
  if (mocni.length !== 1) return;
  const k = mocni[0];
  db()
    .prepare(
      `UPDATE zwrot SET sgt_dok_id=?, sgt_dok_numer=?, sgt_dok_typ=?, dopasowanie='auto' WHERE id=?`
    )
    .run(k.dokId, k.numer, k.typ, zwrotId);
  logEvent("zwrot_dokument", autor, null, {
    zwrotId,
    dokId: k.dokId,
    numer: k.numer,
    dopasowanie: "auto",
    punkty: k.punkty,
  });
}

/** Ręczny wybór dokumentu z kandydatów (albo poprawka po pomyłce auto). */
export function ustawDokument(zwrotId: number, dokId: number, autor: string): SzczegolZwrotu {
  const z = wierszZwrotu(zwrotId);
  zabronPoRozliczeniu(z);
  const dok = db()
    .prepare("SELECT nr_pelny, typ FROM sgt_sprzedaz WHERE dok_id = ?")
    .get(dokId) as { nr_pelny: string; typ: string } | undefined;
  if (!dok) {
    throw new BladZwrotu(
      400,
      `Dokument ${dokId} nie istnieje w oknie sprzedaży — odśwież listę kandydatów`
    );
  }
  db()
    .prepare(
      "UPDATE zwrot SET sgt_dok_id=?, sgt_dok_numer=?, sgt_dok_typ=?, dopasowanie='reczne' WHERE id=?"
    )
    .run(dokId, dok.nr_pelny, dok.typ, zwrotId);
  logEvent("zwrot_dokument", autor, null, { zwrotId, dokId, numer: dok.nr_pelny, dopasowanie: "reczne" });
  return szczegolZwrotu(zwrotId);
}

/** Cofnięcie dopasowania — pomyłki się zdarzają, audyt trzyma historię. */
export function zdejmijDokument(zwrotId: number, autor: string): SzczegolZwrotu {
  const z = wierszZwrotu(zwrotId);
  zabronPoRozliczeniu(z);
  db()
    .prepare(
      "UPDATE zwrot SET sgt_dok_id=NULL, sgt_dok_numer=NULL, sgt_dok_typ=NULL, dopasowanie='brak' WHERE id=?"
    )
    .run(zwrotId);
  logEvent("zwrot_dokument", autor, null, { zwrotId, dokId: null, dopasowanie: "brak" });
  return szczegolZwrotu(zwrotId);
}

// ── Decyzje i maszyna stanów ────────────────────────────────────────────────

export function zapiszDecyzje(
  zwrotId: number,
  pozycjaId: number,
  decyzja: string,
  notatka: string | null,
  autor: string
): SzczegolZwrotu {
  if (!(DECYZJE as readonly string[]).includes(decyzja)) {
    throw new BladZwrotu(400, `Nieznana decyzja „${decyzja}” — dozwolone: ${DECYZJE.join(", ")}`);
  }
  const z = wierszZwrotu(zwrotId);
  /* Decyzję MOŻNA zmieniać do rozliczenia — pomyłki przy ocenie towaru się
     zdarzają, a historia zmian i tak siedzi w events. Po rozliczeniu stop:
     pieniądze oddano na podstawie tego, co było na ekranie. */
  zabronPoRozliczeniu(z);
  const poz = db()
    .prepare("SELECT id, tw_id FROM zwrot_pozycja WHERE id = ? AND zwrot_id = ?")
    .get(pozycjaId, zwrotId) as { id: number; tw_id: number | null } | undefined;
  if (!poz) throw new BladZwrotu(404, `Pozycja ${pozycjaId} nie należy do zwrotu ${zwrotId}`);

  db()
    .prepare(
      "UPDATE zwrot_pozycja SET decyzja=?, decyzja_at=?, decyzja_przez=?, notatka=? WHERE id=?"
    )
    .run(decyzja, nowIso(), autor, notatka, pozycjaId);
  przeliczStatus(zwrotId);
  logEvent("zwrot_decyzja", autor, poz.tw_id, { zwrotId, pozycjaId, decyzja, notatka });
  return szczegolZwrotu(zwrotId);
}

/** Pozycja zwrotu ręcznego — wskazana kartoteka zamiast danych z Allegro. */
export function dodajPozycjeReczna(
  zwrotId: number,
  twId: number,
  ilosc: number,
  autor: string
): SzczegolZwrotu {
  const z = wierszZwrotu(zwrotId);
  zabronPoRozliczeniu(z);
  if (!(ilosc > 0)) throw new BladZwrotu(400, "Ilość musi być dodatnia");
  const t = db()
    .prepare("SELECT tw_id, symbol, nazwa FROM sgt_towar WHERE tw_id = ?")
    .get(twId) as { tw_id: number; symbol: string; nazwa: string } | undefined;
  if (!t) throw new BladZwrotu(400, `Kartoteka tw_id=${twId} nie istnieje`);
  db()
    .prepare(
      "INSERT INTO zwrot_pozycja(zwrot_id, nazwa, external_id, tw_id, ilosc) VALUES (?,?,?,?,?)"
    )
    .run(zwrotId, t.nazwa, t.symbol, twId, ilosc);
  przeliczStatus(zwrotId);
  logEvent("zwrot_pozycja_reczna", autor, twId, { zwrotId, ilosc });
  return szczegolZwrotu(zwrotId);
}

/**
 * Stempel „pieniądze oddane w panelu Allegro". Wymaga statusu `oceniony`:
 * kolejność procesu to najpierw ocena towaru, potem pieniądze — stempel na
 * nieocenionym zwrocie znaczyłby, że ktoś oddał środki przed obejrzeniem paczki.
 */
export function oznaczZwrotSrodkow(zwrotId: number, autor: string): SzczegolZwrotu {
  const z = wierszZwrotu(zwrotId);
  if (z.zwrot_srodkow_at) return szczegolZwrotu(zwrotId); // idempotentne
  if (z.status !== "oceniony") {
    throw new BladZwrotu(400, "Najpierw decyzje przy każdej pozycji — potem zwrot środków");
  }
  db()
    .prepare("UPDATE zwrot SET zwrot_srodkow_at=?, zwrot_srodkow_przez=? WHERE id=?")
    .run(nowIso(), autor, zwrotId);
  przeliczStatus(zwrotId);
  logEvent("zwrot_srodki", autor, null, { zwrotId });
  return szczegolZwrotu(zwrotId);
}

/**
 * Status jest POCHODNĄ danych, nie osobną decyzją:
 *   wszystkie pozycje z decyzją → `oceniony`; + stempel środków → `rozliczony`.
 * `do_wyjasnienia` świadomie NIE blokuje `oceniony` — zablokuje dopiero
 * korektę w Etapie 2 (korekta zejdzie z pozycji rozstrzygniętych).
 */
function przeliczStatus(zwrotId: number): void {
  const d = db();
  const c = d
    .prepare(
      `SELECT COUNT(*) AS pozycji, SUM(CASE WHEN decyzja IS NULL THEN 1 ELSE 0 END) AS bez
       FROM zwrot_pozycja WHERE zwrot_id = ?`
    )
    .get(zwrotId) as { pozycji: number; bez: number | null };
  const z = d
    .prepare("SELECT zwrot_srodkow_at FROM zwrot WHERE id = ?")
    .get(zwrotId) as { zwrot_srodkow_at: string | null };
  const oceniony = c.pozycji > 0 && (c.bez ?? 0) === 0;
  const status = oceniony ? (z.zwrot_srodkow_at ? "rozliczony" : "oceniony") : "nowy";
  d.prepare("UPDATE zwrot SET status=? WHERE id=?").run(status, zwrotId);
}

// ── Odczyty ─────────────────────────────────────────────────────────────────

export interface WierszListy {
  id: number;
  referencja: string | null;
  waybill: string;
  status: string;
  kupujacyLogin: string | null;
  utworzonoAt: string;
  dokumentNumer: string | null;
  pozycji: number;
  ocenionych: number;
}

export function listaZwrotow(filtr: { status?: string; szukaj?: string; limit?: number }): WierszListy[] {
  const warunki: string[] = [];
  const args: unknown[] = [];
  if (filtr.status) {
    warunki.push("z.status = ?");
    args.push(filtr.status);
  }
  if (filtr.szukaj) {
    warunki.push("(z.waybill LIKE ? OR z.referencja LIKE ? OR z.kupujacy_login LIKE ?)");
    const q = `%${filtr.szukaj}%`;
    args.push(q, q, q);
  }
  const where = warunki.length ? `WHERE ${warunki.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filtr.limit ?? 100, 1), 500);
  const wiersze = db()
    .prepare(
      `SELECT z.id, z.referencja, z.waybill, z.status, z.kupujacy_login, z.utworzono_at,
              z.sgt_dok_numer,
              COUNT(p.id) AS pozycji,
              SUM(CASE WHEN p.decyzja IS NOT NULL THEN 1 ELSE 0 END) AS ocenionych
       FROM zwrot z LEFT JOIN zwrot_pozycja p ON p.zwrot_id = z.id
       ${where}
       GROUP BY z.id ORDER BY z.id DESC LIMIT ${limit}`
    )
    .all(...(args as never[])) as Array<{
    id: number; referencja: string | null; waybill: string; status: string;
    kupujacy_login: string | null; utworzono_at: string; sgt_dok_numer: string | null;
    pozycji: number; ocenionych: number | null;
  }>;
  return wiersze.map((w) => ({
    id: w.id,
    referencja: w.referencja,
    waybill: w.waybill,
    status: w.status,
    kupujacyLogin: w.kupujacy_login,
    utworzonoAt: w.utworzono_at,
    dokumentNumer: w.sgt_dok_numer,
    pozycji: w.pozycji,
    ocenionych: w.ocenionych ?? 0,
  }));
}

export function szczegolZwrotu(id: number): SzczegolZwrotu {
  const z = wierszZwrotu(id);
  const pozycje = db()
    .prepare(
      `SELECT p.id, p.offer_id, p.nazwa, p.external_id, p.tw_id, t.symbol, p.ilosc,
              p.powod, p.powod_opis, p.decyzja, p.decyzja_at, p.decyzja_przez, p.notatka
       FROM zwrot_pozycja p LEFT JOIN sgt_towar t ON t.tw_id = p.tw_id
       WHERE p.zwrot_id = ? ORDER BY p.id`
    )
    .all(id) as Array<{
    id: number; offer_id: string | null; nazwa: string; external_id: string | null;
    tw_id: number | null; symbol: string | null; ilosc: number; powod: string | null;
    powod_opis: string | null; decyzja: string | null; decyzja_at: string | null;
    decyzja_przez: string | null; notatka: string | null;
  }>;

  /* Zwracane oferty — po nich znakujemy wiersze zamówienia. Zbiór, nie
     pętla po tablicy: zamówienie potrafi mieć kilkanaście pozycji. */
  const zwracaneOferty = new Set(
    pozycje.map((p) => p.offer_id).filter((o): o is string => !!o)
  );
  const pozycjeZamowienia = (
    db()
      .prepare(
        `SELECT p.offer_id, p.nazwa, p.external_id, p.tw_id, t.symbol, p.ilosc
         FROM zwrot_zam_pozycja p LEFT JOIN sgt_towar t ON t.tw_id = p.tw_id
         WHERE p.zwrot_id = ? ORDER BY p.id`
      )
      .all(id) as Array<{
      offer_id: string | null; nazwa: string; external_id: string | null;
      tw_id: number | null; symbol: string | null; ilosc: number;
    }>
  ).map((p) => ({
    offerId: p.offer_id,
    nazwa: p.nazwa,
    externalId: p.external_id,
    twId: p.tw_id,
    symbol: p.symbol,
    ilosc: p.ilosc,
    zwracana: !!p.offer_id && zwracaneOferty.has(p.offer_id),
  }));

  const szczegol: SzczegolZwrotu = {
    id: z.id,
    allegroReturnId: z.allegro_return_id,
    allegroOrderId: z.allegro_order_id,
    referencja: z.referencja,
    waybill: z.waybill,
    status: z.status,
    statusAllegro: z.status_allegro,
    kupujacyLogin: z.kupujacy_login,
    kupujacyId: z.kupujacy_id,
    kupujacyEmail: z.kupujacy_email,
    utworzonoAllegro: z.utworzono_allegro,
    utworzonoAt: z.utworzono_at,
    utworzonoPrzez: z.utworzono_przez,
    dokument: z.sgt_dok_id
      ? { dokId: z.sgt_dok_id, numer: z.sgt_dok_numer, typ: z.sgt_dok_typ, dopasowanie: z.dopasowanie }
      : null,
    zwrotSrodkow: z.zwrot_srodkow_at
      ? { at: z.zwrot_srodkow_at, przez: z.zwrot_srodkow_przez ?? "?" }
      : null,
    linkPanel: LINK_PANELU_ZWROTOW,
    pozycjeZamowienia,
    pozycje: pozycje.map((p) => ({
      id: p.id,
      offerId: p.offer_id,
      nazwa: p.nazwa,
      externalId: p.external_id,
      twId: p.tw_id,
      symbol: p.symbol,
      ilosc: p.ilosc,
      powod: p.powod,
      powodOpis: p.powod_opis,
      decyzja: p.decyzja,
      decyzjaAt: p.decyzja_at,
      decyzjaPrzez: p.decyzja_przez,
      notatka: p.notatka,
    })),
  };
  if (!z.sgt_dok_id) szczegol.kandydaciDokumentu = kandydaciDokumentu(id);
  return szczegol;
}

// ── Wiadomości z klientem (Centrum wiadomości Allegro) ──────────────────────

/**
 * Wątek rozmowy z kupującym — czytany NA ŻĄDANIE, prosto z Allegro.
 *
 * Świadomie NIE zapisujemy go u siebie: rozmowa toczy się dalej po ocenie
 * towaru, więc kopia starzałaby się od pierwszej odpowiedzi, a przy okazji
 * mnożyła dane osobowe w naszej bazie. Karta pokazuje to, co Allegro ma
 * TERAZ, albo uczciwie mówi, że korespondencji nie ma.
 */
export async function watekZwrotu(zwrotId: number): Promise<{
  login: string | null;
  szukanie: SzukanieWatku | null;
}> {
  const z = wierszZwrotu(zwrotId);
  /* Login i identyfikator NARAZ, bo lista wątków maskuje rozmówcę: w
     `interlocutor.login` siedzi `client:44300444`, a nie login z zamówienia.
     Szukanie po samym loginie nie trafiało nigdy — stąd „brak korespondencji"
     przy zwrotach, w których rozmowa istniała. */
  const kto = { login: z.kupujacy_login, id: z.kupujacy_id };
  if (!kto.login && !kto.id) return { login: null, szukanie: null };
  const szukanie = await allegroAdapter().watekKupujacego(kto, z.utworzono_allegro);
  return { login: z.kupujacy_login ?? z.kupujacy_id, szukanie };
}

// ── Pomocnicze ──────────────────────────────────────────────────────────────

/** Błąd wołającego z kodem HTTP — trasa tłumaczy go 1:1, bez zgadywania. */
export class BladZwrotu extends Error {
  constructor(
    public readonly kod: number,
    wiadomosc: string
  ) {
    super(wiadomosc);
  }
}

function wierszZwrotu(id: number): WierszZwrotu {
  const z = db().prepare("SELECT * FROM zwrot WHERE id = ?").get(id) as WierszZwrotu | undefined;
  if (!z) throw new BladZwrotu(404, `Zwrot ${id} nie istnieje`);
  return z;
}

function zabronPoRozliczeniu(z: WierszZwrotu): void {
  if (z.status === "rozliczony") {
    throw new BladZwrotu(400, "Zwrot jest rozliczony — środki oddano na podstawie tych decyzji");
  }
}
