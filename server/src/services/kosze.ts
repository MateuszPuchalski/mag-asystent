import { db, nowIso, transaction } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { enqueueMM, enqueueSetLocation } from "./queue.js";
import { adresyOczekiwane, porownajAlejkowo, validateDeliveryLocation } from "./delivery.js";
import { aliasKodu } from "./ean-alias.js";
import { parseLocs } from "../locs.js";
import { logEvent } from "./events.js";
import { pozycjeDoKorekty } from "./zwroty.js";

/* ── Cyfrowe kosze zwrotowe (Etap 3) ─────────────────────────────────────────
   Kosz zastępuje papierową kartkę wożoną z towarem. Cykl życia:

     biuro: przypina zwroty skanem kodu kosza (wymóg: dokumenty już zlecone,
            bo kosz wiąże się z korektą i MM — nie z „może kiedyś")
     biuro: zamyka kosz → SNAPSHOT pozycji (co fizycznie leży w środku)
     hala:  kolektor pokazuje zamknięte kosze; skan towaru wskazuje pozycję,
            skan regału ją odkłada — jak przy dostawach
     hala:  ZAKOŃCZ → MM ZWROTY→MAG per pozycja cofa bufor automatycznie

   MM cofające są JEDNOPOZYCYJNE świadomie: guard „adres przed
   sprzedawalnością" w obu workerach porządkuje zadania po tw_id, a MM
   wielopozycyjne wypadałoby spod niego. Zapis adresu z odkładania MUSI wejść
   do Subiekta przed zadaniem, które czyni towar sprzedawalnym.               */

export class BladKosza extends Error {
  constructor(
    public kod: number,
    msg: string
  ) {
    super(msg);
  }
}

interface WierszKosza {
  id: number;
  kod: string;
  status: string;
  utworzono_at: string;
  utworzono_przez: string;
  zamknieto_at: string | null;
  rozlozono_at: string | null;
}

export interface PozycjaKosza {
  id: number;
  zwrotId: number;
  twId: number;
  symbol: string;
  nazwa: string;
  ilosc: number;
  status: string;
  /** Adres ŻYWY z kartoteki skorygowany o kolejkę — nie snapshot. */
  lokOczekiwana: string | null;
  lokFaktyczna: string | null;
  odlozonoPrzez: string | null;
  /** Stan zadania MM cofającego bufor; null przed zakończeniem kosza. */
  mmStatus: string | null;
  mmNumer: string | null;
}

export interface SzczegolKosza {
  id: number;
  kod: string;
  status: string;
  utworzonoAt: string;
  zamknietoAt: string | null;
  rozlozonoAt: string | null;
  zwroty: Array<{ id: number; referencja: string | null; waybill: string }>;
  pozycje: PozycjaKosza[];
  odlozonych: number;
}

export interface WierszListyKoszy {
  id: number;
  kod: string;
  status: string;
  zwrotow: number;
  pozycji: number;
  odlozonych: number;
  utworzonoAt: string;
  zamknietoAt: string | null;
}

/** Kod z etykiety kosza — po trim/upper, żeby skan i wpis ręczny się spotkały. */
function normalizujKod(raw: string): string {
  const kod = raw.trim().toUpperCase();
  if (!kod) throw new BladKosza(400, "Zeskanuj albo wpisz kod kosza");
  return kod;
}

function wierszKosza(id: number): WierszKosza {
  const k = db().prepare("SELECT * FROM kosz WHERE id = ?").get(id) as WierszKosza | undefined;
  if (!k) throw new BladKosza(404, `Kosz ${id} nie istnieje`);
  return k;
}

/** Aktywny (nierozłożony) kosz o tym kodzie — kod wraca do obiegu po rozłożeniu. */
export function koszPoKodzie(raw: string): WierszKosza | undefined {
  return db()
    .prepare("SELECT * FROM kosz WHERE kod = ? AND status <> 'rozlozony'")
    .get(normalizujKod(raw)) as WierszKosza | undefined;
}

/**
 * Przypięcie zwrotu do kosza — skanem kodu na karcie zwrotu.
 *
 * Kosz o nieznanym kodzie POWSTAJE tutaj: rejestr koszy prowadzony osobno
 * byłby drugą listą do pilnowania, a etykieta na fizycznym koszu i tak jest
 * jedynym źródłem prawdy o tym, które kosze istnieją.
 */
export function przypnijZwrot(zwrotId: number, kodRaw: string, autor: string): void {
  const kod = normalizujKod(kodRaw);
  const z = db()
    .prepare("SELECT id, kosz_id, korekta_queue_id FROM zwrot WHERE id = ?")
    .get(zwrotId) as { id: number; kosz_id: number | null; korekta_queue_id: number | null } | undefined;
  if (!z) throw new BladKosza(404, `Zwrot ${zwrotId} nie istnieje`);
  /* Kosz wiąże się z DOKUMENTEM MM (proces, krok 6) — bez zleconych
     dokumentów nie ma czego wiązać, a towar bez korekty nie ma prawa
     jechać na bufor. */
  if (!z.korekta_queue_id) {
    throw new BladKosza(400, "Najpierw wystaw korektę i MM — kosz wiąże się z dokumentem");
  }
  if (pozycjeDoKorekty(zwrotId).length === 0) {
    throw new BladKosza(400, "Zwrot nie ma pozycji pełnowartościowych — nie ma czego włożyć do kosza");
  }

  const d = db();
  transaction(d, () => {
    let kosz = koszPoKodzie(kod);
    if (kosz && kosz.status !== "otwarty") {
      throw new BladKosza(400, `Kosz ${kod} jest zamknięty — do rozłożenia, nie do dokładania`);
    }
    if (!kosz) {
      const res = d
        .prepare("INSERT INTO kosz(kod, status, utworzono_at, utworzono_przez) VALUES (?, 'otwarty', ?, ?)")
        .run(kod, nowIso(), autor);
      kosz = wierszKosza(Number(res.lastInsertRowid));
    }
    if (z.kosz_id === kosz.id) return; // drugi skan tego samego kosza — nic do zrobienia
    if (z.kosz_id) {
      throw new BladKosza(400, "Zwrot leży już w innym koszu — najpierw go odepnij");
    }
    d.prepare("UPDATE zwrot SET kosz_id = ? WHERE id = ?").run(kosz.id, zwrotId);
    logEvent("kosz_przypiecie", autor, null, { zwrotId, koszId: kosz.id, kod });
  })();
}

export function odepnijZwrot(zwrotId: number, autor: string): void {
  const z = db().prepare("SELECT kosz_id FROM zwrot WHERE id = ?").get(zwrotId) as
    | { kosz_id: number | null }
    | undefined;
  if (!z) throw new BladKosza(404, `Zwrot ${zwrotId} nie istnieje`);
  if (!z.kosz_id) return;
  const kosz = wierszKosza(z.kosz_id);
  if (kosz.status !== "otwarty") {
    throw new BladKosza(400, "Kosz jest już zamknięty — zawartość idzie na halę w komplecie");
  }
  db().prepare("UPDATE zwrot SET kosz_id = NULL WHERE id = ?").run(zwrotId);
  logEvent("kosz_odpiecie", autor, null, { zwrotId, koszId: kosz.id, kod: kosz.kod });
}

/**
 * Zamknięcie kosza — od tej chwili to jednostka pracy dla hali.
 *
 * Snapshot pozycji powstaje TERAZ, nie przy przypinaniu: dokłada się do kosza
 * partiami, a listą do rozłożenia ma być stan z chwili, gdy biuro mówi
 * „komplet". Adres do snapshotu nie wchodzi — liczy się żywy (patrz schema).
 */
export function zamknijKosz(koszId: number, autor: string): SzczegolKosza {
  const kosz = wierszKosza(koszId);
  if (kosz.status !== "otwarty") throw new BladKosza(400, "Kosz nie jest otwarty");
  const zwroty = db()
    .prepare(
      `SELECT z.id, z.referencja, z.waybill, q.status AS dok_status
       FROM zwrot z LEFT JOIN sfera_queue q ON q.id = z.korekta_queue_id
       WHERE z.kosz_id = ?`
    )
    .all(koszId) as Array<{ id: number; referencja: string | null; waybill: string; dok_status: string | null }>;
  if (zwroty.length === 0) throw new BladKosza(400, "Pusty kosz nie ma czego jechać na halę");
  /* Kosz jedzie na halę dopiero, gdy korekty i MM NAPRAWDĘ weszły do
     Subiekta. Zamknięcie z zadaniem w błędzie skończyłoby się cofnięciem
     bufora, na którym tego towaru nigdy nie było — czyli ujemnym stanem. */
  const czekaja = zwroty.filter((z) => z.dok_status !== "done");
  if (czekaja.length > 0) {
    throw new BladKosza(
      400,
      "Dokumenty jeszcze nie weszły do Subiekta dla: " +
        czekaja.map((z) => z.referencja ?? z.waybill).join(", ") +
        " — sprawdź kolejkę zapisów"
    );
  }

  const d = db();
  transaction(d, () => {
    const ins = d.prepare(
      `INSERT INTO kosz_pozycja(kosz_id, zwrot_id, tw_id, symbol, nazwa, ilosc)
       VALUES (?,?,?,?,?,?)`
    );
    let pozycji = 0;
    for (const z of zwroty) {
      for (const p of pozycjeDoKorekty(z.id)) {
        /* Symbol z żywej kartoteki; towar, który wypadł z read-modelu, dostaje
           pustkę — snapshot nazwy i ilości wystarcza, żeby pracować dalej. */
        const t = subiekt.getProductById(p.twId);
        ins.run(koszId, z.id, p.twId, t?.symbol ?? "", p.nazwa, p.ilosc);
        pozycji++;
      }
    }
    if (pozycji === 0) {
      throw new BladKosza(400, "Żaden zwrot w koszu nie ma pozycji pełnowartościowych");
    }
    d.prepare("UPDATE kosz SET status='zamkniety', zamknieto_at=?, zamknieto_przez=? WHERE id=?")
      .run(nowIso(), autor, koszId);
    logEvent("kosz_zamkniety", autor, null, { koszId, kod: kosz.kod, zwrotow: zwroty.length, pozycji });
  })();
  return szczegolKosza(koszId);
}

export function listaKoszy(): WierszListyKoszy[] {
  /* Rozłożone tylko świeże: lista służy pracy, historię trzyma audyt. */
  const wiersze = db()
    .prepare(
      `SELECT k.id, k.kod, k.status, k.utworzono_at, k.zamknieto_at,
              (SELECT COUNT(*) FROM zwrot z WHERE z.kosz_id = k.id) AS zwrotow,
              (SELECT COUNT(*) FROM kosz_pozycja p WHERE p.kosz_id = k.id) AS pozycji,
              (SELECT COUNT(*) FROM kosz_pozycja p WHERE p.kosz_id = k.id AND p.status='done') AS odlozonych
       FROM kosz k
       WHERE k.status <> 'rozlozony' OR k.rozlozono_at >= datetime('now', '-14 days')
       ORDER BY CASE k.status WHEN 'otwarty' THEN 0 WHEN 'zamkniety' THEN 1 ELSE 2 END, k.id DESC`
    )
    .all() as Array<Record<string, unknown>>;
  return wiersze.map((w) => ({
    id: w.id as number,
    kod: w.kod as string,
    status: w.status as string,
    zwrotow: w.zwrotow as number,
    pozycji: w.pozycji as number,
    odlozonych: w.odlozonych as number,
    utworzonoAt: w.utworzono_at as string,
    zamknietoAt: (w.zamknieto_at as string) ?? null,
  }));
}

/** Kosze do rozłożenia — to, co widzi kolektor na zakładce DOSTAWY. */
export function koszeDlaKolektora(): WierszListyKoszy[] {
  return listaKoszy().filter((k) => k.status === "zamkniety");
}

export function szczegolKosza(koszId: number): SzczegolKosza {
  const kosz = wierszKosza(koszId);
  const zwroty = db()
    .prepare("SELECT id, referencja, waybill FROM zwrot WHERE kosz_id = ? ORDER BY id")
    .all(koszId) as Array<{ id: number; referencja: string | null; waybill: string }>;
  const wiersze = db()
    .prepare(
      `SELECT p.*, q.status AS mm_status, q.sgt_doc_number AS mm_numer
       FROM kosz_pozycja p LEFT JOIN sfera_queue q ON q.id = p.mm_queue_id
       WHERE p.kosz_id = ?`
    )
    .all(koszId) as Array<Record<string, unknown>>;

  const adresy = adresyOczekiwane(wiersze.map((w) => w.tw_id as number));
  const pozycje: PozycjaKosza[] = wiersze.map((w) => ({
    id: w.id as number,
    zwrotId: w.zwrot_id as number,
    twId: w.tw_id as number,
    symbol: w.symbol as string,
    nazwa: w.nazwa as string,
    ilosc: w.ilosc as number,
    status: w.status as string,
    /* Pozycja tknięta pokazuje SWÓJ zapis — to, co człowiek zrobił; reszta
       adres żywy. Ten sam podział co `adresLinii` przy dostawach. */
    lokOczekiwana: (w.lok_faktyczna as string) ?? adresy.get(w.tw_id as number) ?? null,
    lokFaktyczna: (w.lok_faktyczna as string) ?? null,
    odlozonoPrzez: (w.odlozono_przez as string) ?? null,
    mmStatus: (w.mm_status as string) ?? null,
    mmNumer: (w.mm_numer as string) ?? null,
  }));
  pozycje.sort((a, b) =>
    porownajAlejkowo(
      { locExpected: a.lokOczekiwana, sym: a.symbol },
      { locExpected: b.lokOczekiwana, sym: b.symbol }
    )
  );
  return {
    id: kosz.id,
    kod: kosz.kod,
    status: kosz.status,
    utworzonoAt: kosz.utworzono_at,
    zamknietoAt: kosz.zamknieto_at,
    rozlozonoAt: kosz.rozlozono_at,
    zwroty,
    pozycje,
    odlozonych: pozycje.filter((p) => p.status === "done").length,
  };
}

/**
 * Skan towaru w otwartym koszu na kolektorze → która pozycja.
 *
 * Ta sama drabinka co globalny skan (EAN → alias → symbol), ale wynik szuka
 * się wyłącznie WŚRÓD POZYCJI KOSZA: skan cudzego towaru ma powiedzieć
 * „nie z tego kosza", a nie otworzyć przypadkową kartę.
 */
export function skanTowaruKosza(
  koszId: number,
  code: string
): { pozycjaId: number } | { poza: true; symbol: string } | { nieznany: true } {
  const raw = code.trim();
  const p = subiekt.getProductByEan(raw) ?? (aliasKodu(raw) ? subiekt.getProductById(aliasKodu(raw)!.twId) : undefined);
  const tw = p ?? subiekt.getProductBySymbol(raw.toUpperCase()) ?? subiekt.getProductBySymbol(raw);
  if (!tw) return { nieznany: true };
  const poz = db()
    .prepare(
      "SELECT id FROM kosz_pozycja WHERE kosz_id = ? AND tw_id = ? AND status='todo' ORDER BY id LIMIT 1"
    )
    .get(koszId, tw.tw_id) as { id: number } | undefined;
  if (!poz) return { poza: true, symbol: tw.symbol };
  return { pozycjaId: poz.id };
}

/**
 * Odłożenie pozycji kosza pod zeskanowany adres.
 *
 * Zapis adresu do kartoteki idzie TYLKO przy zmianie i PRZED zadaniem MM
 * (kolejność wstawienia + guard po tw_id) — towar nie ma prawa stać się
 * sprzedawalny pod adresem, którego jeszcze nie ma w Subiekcie.
 */
export function odlozPozycje(
  pozycjaId: number,
  lokalizacja: string,
  autor: string,
  recznie = false
): { ok: true; mismatch: boolean } {
  const p = db().prepare("SELECT * FROM kosz_pozycja WHERE id = ?").get(pozycjaId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  const kosz = wierszKosza(p.kosz_id as number);
  if (kosz.status !== "zamkniety") {
    throw new BladKosza(400, "Kosz nie jest w rozkładaniu — otwarty dokłada, rozłożony skończył");
  }
  if (p.status === "done") throw new BladKosza(400, "Pozycja jest już odłożona");

  const code = lokalizacja.trim().toUpperCase();
  const locErr = validateDeliveryLocation(code);
  if (locErr) throw new BladKosza(400, locErr);

  const twId = p.tw_id as number;
  const oczekiwany = adresyOczekiwane([twId]).get(twId) ?? null;
  const mismatch = !!oczekiwany && oczekiwany !== code;

  const t = subiekt.getProductById(twId);
  const current = parseLocs(t?.lokalizacja);
  if (current[0] !== code) {
    // towar wraca na INNĄ półkę niż zna kartoteka → nowy adres pickingowy
    const newLocs = Array.from(new Set([code, ...current.slice(1)]));
    enqueueSetLocation(
      twId,
      newLocs.join(" ").slice(0, config.locFieldLimit),
      {
        createdBy: autor,
        twId,
        label: "Lokalizacja · " + (t?.symbol ?? twId),
        detail: `${code} (kosz ${kosz.kod})`,
      },
      { locsPrzed: t?.lokalizacja ?? "", zrodlo: "kosz" }
    );
  }

  db()
    .prepare("UPDATE kosz_pozycja SET status='done', lok_faktyczna=?, odlozono_at=?, odlozono_przez=? WHERE id=?")
    .run(code, nowIso(), autor, pozycjaId);

  if (recznie) logEvent("manual_entry", autor, twId, { code, kind: "LOC", zrodlo: "kosz" });
  logEvent("kosz_putaway", autor, twId, {
    koszId: kosz.id,
    pozycjaId,
    qty: p.ilosc,
    location: code,
    expected: oczekiwany,
  });
  if (mismatch) {
    // częstotliwość per lokalizacja = ten sam raport przepełnionych gniazd
    logEvent("location_mismatch", autor, twId, { pozycjaId, expected: oczekiwany, actual: code, zrodlo: "kosz" });
  }
  return { ok: true, mismatch };
}

/**
 * Zakończenie rozkładania: bufor cofa się SAM.
 *
 * To jest krok 9 procesu — dotąd ktoś przy komputerze musiał pamiętać
 * o dokumencie cofającym. Teraz zatwierdzenie rozłożenia na kolektorze
 * kolejkuje MM ZWROTY→MAG per pozycja i nikt niczego nie pilnuje ręką.
 */
export function zakonczKosz(koszId: number, autor: string): SzczegolKosza {
  const kosz = wierszKosza(koszId);
  if (kosz.status === "rozlozony") return szczegolKosza(koszId); // drugie kliknięcie
  if (kosz.status !== "zamkniety") throw new BladKosza(400, "Kosz nie jest w rozkładaniu");
  const pozycje = db()
    .prepare("SELECT id, tw_id, symbol, ilosc, status FROM kosz_pozycja WHERE kosz_id = ?")
    .all(koszId) as Array<{ id: number; tw_id: number; symbol: string; ilosc: number; status: string }>;
  const braki = pozycje.filter((p) => p.status !== "done");
  if (braki.length > 0) {
    throw new BladKosza(400, `Nieodłożone pozycje: ${braki.map((b) => b.symbol || b.tw_id).join(", ")}`);
  }

  const d = db();
  transaction(d, () => {
    for (const p of pozycje) {
      const queueId = enqueueMM(config.magId.ZWROTY, config.magId.MAG, [{ twId: p.tw_id, qty: p.ilosc }], {
        createdBy: autor,
        twId: p.tw_id,
        label: "MM zwroty→magazyn · " + (p.symbol || p.tw_id),
        detail: `Kosz ${kosz.kod} rozłożony`,
      });
      d.prepare("UPDATE kosz_pozycja SET mm_queue_id = ? WHERE id = ?").run(queueId, p.id);
    }
    d.prepare("UPDATE kosz SET status='rozlozony', rozlozono_at=?, rozlozono_przez=? WHERE id=?")
      .run(nowIso(), autor, koszId);
    logEvent("kosz_rozlozony", autor, null, { koszId, kod: kosz.kod, pozycji: pozycje.length });
  })();
  return szczegolKosza(koszId);
}
