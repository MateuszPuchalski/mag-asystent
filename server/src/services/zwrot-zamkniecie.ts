import { transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import { ZwrotConflict } from "./zwroty.js";

/* ── Ręczne zamknięcie zwrotu, bez korekty ───────────────────────────────────
   Zwrot zamykała dotąd wyłącznie korekta (ręka, automat albo Sfera) albo
   wypłata z Allegro. Zostawały sprawy, których nic z tego nie domknie:
   pieniądze oddane poza aplikacją, zwrot bez towaru, historia sprzed panelu.
   Stały w kolejce bez końca, a kolejka, której nie da się opróżnić, uczy ją
   ignorować.

   TYLKO U NAS. Zamknięcie nie wysyła nic do Allegro (ani zwrotu pieniędzy, ani
   odmowy) i nie dotyka Subiekta: nie ma korekty, nie ma MM. Dlatego bez
   `autoryzuj()` i bez potwierdzenia — da się je cofnąć jednym ruchem, a ślad
   z nazwiskiem zostaje w dzienniku i na osi zwrotu.

   `zamkniety_at` ustawiamy też, mimo osobnych kolumn: pół aplikacji pyta
   o zamknięcie właśnie po nim (automat ZW, profil klienta, synchronizacja),
   a każde z tych miejsc ma wtedy zwrot po cichu zostawić w spokoju.          */

/** Najwięcej znaków powodu. Idzie do dziennika i na oś zwrotu. */
export const LIMIT_POWODU_ZAMKNIECIA = 250;

type Wiersz = {
  wersja: number; zamkniety_at: string | null; werdykt: string | null;
  rejection_code: string | null; zamkniecie_reczne_at: string | null;
  external_id: string;
};

const wczytaj = (database: Db, zwrotId: number): Wiersz => {
  const w = database.prepare(`SELECT wersja, zamkniety_at, werdykt, rejection_code,
      zamkniecie_reczne_at, external_id FROM zwrot_klienta WHERE id = ?`)
    .get(zwrotId) as Wiersz | undefined;
  if (!w) throw new Error("Nie znaleziono zwrotu");
  return w;
};

function sprawdzWersje(w: Wiersz, wersja: number): void {
  if (Number(w.wersja) !== wersja) {
    throw new ZwrotConflict(
      "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.",
      { wersja: Number(w.wersja), przyslana: wersja });
  }
}

/**
 * Czy towar z tego zwrotu leży w koszyku, który jeszcze nie został rozłożony.
 * Koszyk czeka na korektę każdego zwrotu, z którego ma pozycje; zwrot zamknięty
 * bez korekty zablokowałby go na zawsze.
 */
function maTowarWKoszyku(database: Db, zwrotId: number): boolean {
  return Boolean(database.prepare(`SELECT 1 FROM kosz_pozycja kp
      JOIN zwrot_klienta_pozycja p ON p.id = kp.zwrot_pozycja_id
      JOIN kosz k ON k.id = kp.kosz_id
     WHERE p.zwrot_id = ? AND k.status IN ('otwarty', 'zamkniety') LIMIT 1`).get(zwrotId));
}

export function zamknijZwrotRecznie(
  database: Db, zwrotId: number, wersja: number, powod: string | null,
  kto: { id: number; name: string }, teraz = new Date(),
): { zamknietyAt: string; wersja: number } {
  const uzasadnienie = (powod ?? "").trim();
  if (uzasadnienie.length > LIMIT_POWODU_ZAMKNIECIA) {
    throw new Error(`Powód zamknięcia ma najwyżej ${LIMIT_POWODU_ZAMKNIECIA} znaków.`);
  }
  return transaction(database, () => {
    const w = wczytaj(database, zwrotId);
    sprawdzWersje(w, wersja);
    if (w.zamkniety_at) throw new Error("Zwrot jest już zamknięty.");
    if (w.werdykt === "odrzucony" || w.rejection_code) {
      throw new Error("Zwrot jest już odrzucony — nie ma czego zamykać.");
    }
    if (maTowarWKoszyku(database, zwrotId)) {
      throw new Error(
        "Towar z tego zwrotu leży w koszyku, który czeka na korektę. " +
        "Zamknij go korektą albo zdejmij towar z koszyka.");
    }
    const kiedy = teraz.toISOString();
    database.prepare(`UPDATE zwrot_klienta
      SET zamkniety_at=?, zamkniecie_reczne_at=?, zamkniecie_reczne_przez=?,
          zamkniecie_reczne_user_id=?, zamkniecie_reczne_powod=?, wersja=wersja+1
      WHERE id=?`).run(kiedy, kiedy, kto.name, kto.id, uzasadnienie || null, zwrotId);
    database.prepare(`INSERT INTO zwrot_zdarzenie
      (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(zwrotId, "zamkniecie_reczne",
        uzasadnienie ? `Zamknięto ręcznie: ${uzasadnienie}` : "Zamknięto ręcznie",
        JSON.stringify({ powod: uzasadnienie || null }), kiedy, kto.name, kto.id);
    logEvent("zwrot_zamkniecie_reczne", kto.name, null,
      { zwrotId, powod: uzasadnienie || null }, kto.id, database);
    return { zamknietyAt: kiedy, wersja: wersja + 1 };
  })();
}

/**
 * Cofnięcie ręcznego zamknięcia — zwrot wraca do kolejki tam, gdzie stał.
 * Dotyczy WYŁĄCZNIE zwrotu zamkniętego ręcznie: zamknięcie korektą cofa się
 * osobno (`cofnijKorekte`), bo wiąże się z dokumentem w Subiekcie.
 */
export function otworzZwrotPoRecznymZamknieciu(
  database: Db, zwrotId: number, wersja: number,
  kto: { id: number; name: string }, teraz = new Date(),
): { wersja: number } {
  return transaction(database, () => {
    const w = wczytaj(database, zwrotId);
    sprawdzWersje(w, wersja);
    if (!w.zamkniecie_reczne_at) {
      throw new Error("Ten zwrot nie został zamknięty ręcznie.");
    }
    const kiedy = teraz.toISOString();
    database.prepare(`UPDATE zwrot_klienta
      SET zamkniety_at=NULL, zamkniecie_reczne_at=NULL, zamkniecie_reczne_przez=NULL,
          zamkniecie_reczne_user_id=NULL, zamkniecie_reczne_powod=NULL, wersja=wersja+1
      WHERE id=?`).run(zwrotId);
    database.prepare(`INSERT INTO zwrot_zdarzenie
      (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
      .run(zwrotId, "zamkniecie_reczne_cofniete", "Cofnięto ręczne zamknięcie",
        JSON.stringify({ bylo: w.zamkniecie_reczne_at }), kiedy, kto.name, kto.id);
    logEvent("zwrot_zamkniecie_reczne_cofniete", kto.name, null,
      { zwrotId, bylo: w.zamkniecie_reczne_at }, kto.id, database);
    return { wersja: wersja + 1 };
  })();
}
