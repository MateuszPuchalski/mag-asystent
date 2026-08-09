import { db } from "../db/db.js";
import { subiekt } from "../context.js";
import { classifyScan } from "../scan.js";

/* ── Kody kreskowe nadane w WERTIS (0.37.0) ──────────────────────────────────
   POWSTAŁO Z SYTUACJI PRZY REGALE: magazynier trzyma karton, na kartonie jest
   kod, a kartoteka go nie ma. Do 0.37.0 jedyną drogą było „zapamiętaj i powiedz
   biuru", czyli w praktyce nic — a nazajutrz ten sam karton zatrzymywał pracę
   drugi raz.

   ZAPIS IDZIE DWIEMA DROGAMI I TO JEST DECYZJA, NIE DUBLOWANIE. Kod ląduje
   najpierw tutaj, w bazie WERTIS, a dopiero potem — przez kolejkę — w Subiekcie.
   Powód: zapis do Subiekta bywa OPÓŹNIONY (worker pracuje sekwencyjnie), a bywa
   NIEMOŻLIWY (konto SQL bez `GRANT UPDATE ON tw__Towar (tw_PodstKodKresk)`).
   W obu przypadkach skan ma zadziałać na kolektorze natychmiast, bo to jest
   jedyny powód, dla którego ktoś ten kod nadał. Gdy Subiekta nie da się
   zapisać, funkcja NIE PADA — degraduje się do „działa u nas", a zadanie
   w błędzie mówi biuru, czego brakuje.

   ALIAS JEST FURTKĄ, NIE PIERWSZEŃSTWEM. Szuka się go dopiero wtedy, gdy
   kartoteka nie zwróciła ANI JEDNEGO trafienia. Odwrotna kolejność znaczyłaby,
   że kod nadany przy półce przykrywa kod z Subiekta — czyli że magazynier
   cicho nadpisuje dane, których nie widzi.                                   */

const nowIso = () => new Date().toISOString();

export interface WpisAliasu {
  ean: string;
  twId: number;
  eanPrzed: string | null;
  queueId: number | null;
  createdAt: string;
  createdBy: string;
}

/** Alias dla kodu — `undefined`, gdy nikt takiego nie nadał. */
export function aliasKodu(ean: string): WpisAliasu | undefined {
  const r = db()
    .prepare("SELECT * FROM ean_alias WHERE ean = ?")
    .get(ean.trim()) as
    | { ean: string; tw_id: number; ean_przed: string | null; queue_id: number | null;
        created_at: string; created_by: string }
    | undefined;
  return r
    ? { ean: r.ean, twId: r.tw_id, eanPrzed: r.ean_przed, queueId: r.queue_id,
        createdAt: r.created_at, createdBy: r.created_by }
    : undefined;
}

/** Kody nadane w WERTIS dla tej kartoteki — karta towaru pokazuje je osobno. */
export function aliasyTowaru(twId: number): WpisAliasu[] {
  return (
    // kluczem głównym jest `ean`, więc porządek daje czas nadania, nie rowid
    db().prepare("SELECT * FROM ean_alias WHERE tw_id = ? ORDER BY created_at, ean").all(twId) as any[]
  ).map((r) => ({
    ean: r.ean, twId: r.tw_id, eanPrzed: r.ean_przed, queueId: r.queue_id,
    createdAt: r.created_at, createdBy: r.created_by,
  }));
}

/**
 * Co ten kod już wskazuje — `null`, gdy jest wolny.
 *
 * Sprawdzamy OBIE strony: kartotekę Subiekta i aliasy nadane u nas. Pominięcie
 * którejkolwiek pozwoliłoby nadać kod, który zaraz wskaże dwie kartoteki — czyli
 * własnoręcznie wyprodukować kolizję (§4.5), której cały system stara się unikać.
 */
export function ktoMaTenKod(ean: string): { twId: number; skad: "kartoteka" | "wertis" } | null {
  const kod = ean.trim();
  /* `findProductsByEan`, nie `getProductByEan`: kod potrafi już dziś wskazywać
     kilka kartotek (§4.5) i wtedy KAŻDA z nich jest powodem odmowy. */
  const wKartotece = subiekt.findProductsByEan(kod);
  if (wKartotece.length > 0) return { twId: wKartotece[0].tw_id, skad: "kartoteka" };
  const a = aliasKodu(kod);
  return a ? { twId: a.twId, skad: "wertis" } : null;
}

/** Dlaczego tego kodu nie wolno nadać — `null`, gdy wolno. */
export function bladKodu(ean: string): string | null {
  const kod = (ean ?? "").trim();
  if (!kod) return "Podaj kod kreskowy";
  /* Ten sam klasyfikator, którego używa skaner. Kod o kształcie adresu regału
     wpisany jako EAN zamieniłby przy najbliższym skanie lokalizację w towar —
     a to jest pomyłka, której nikt nie zauważy, dopóki nie zniknie półka. */
  const rodzaj = classifyScan(kod).kind;
  if (rodzaj === "LOC") return `Kod „${kod}" wygląda jak adres regału, nie jak kod towaru`;
  if (rodzaj !== "EAN") {
    return `Kod „${kod}" nie jest kodem kreskowym (oczekiwano 8, 12, 13 albo 14 cyfr)`;
  }
  return null;
}

/**
 * Zapamiętaj kod po stronie WERTIS. Wołane PO sprawdzeniu kolizji.
 *
 * `eanPrzed` jest snapshotem tego, co stało na kartotece — bez niego audyt nie
 * odpowie na pytanie „co tu było wcześniej", a to jest pierwsze pytanie, gdy
 * ktoś zauważy, że stary karton przestał się skanować.
 */
export function zapiszAlias(
  ean: string,
  twId: number,
  eanPrzed: string | null,
  queueId: number | null,
  user: string
): void {
  db()
    .prepare(
      `INSERT INTO ean_alias(ean, tw_id, ean_przed, queue_id, created_at, created_by)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(ean) DO UPDATE SET
         tw_id=excluded.tw_id, ean_przed=excluded.ean_przed,
         queue_id=excluded.queue_id, created_at=excluded.created_at,
         created_by=excluded.created_by`
    )
    .run(ean.trim(), twId, eanPrzed, queueId, nowIso(), user);
}

/**
 * Zdejmij alias, który przestał obowiązywać po podmianie kodu.
 *
 * Stary kod NIE ma dalej wskazywać tej kartoteki: podmiana znaczy „ten karton
 * ma teraz inny kod". Sam kod nie ginie — zostaje w `ean_alias.ean_przed`
 * i w zdarzeniu audytu, więc na pytanie „czemu stary karton się nie skanuje"
 * da się odpowiedzieć.
 */
export function zdejmijAlias(ean: string): void {
  db().prepare("DELETE FROM ean_alias WHERE ean = ?").run(ean.trim());
}
