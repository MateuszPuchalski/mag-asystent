import { db, nextKorektaNumber, nextMmNumber, transaction } from "../db/db.js";
import type { MmItem, SferaAdapter, WynikKorekty, ZlecenieKorekty } from "./sfera.js";

/**
 * DEV — „zapis Sfery" realizowany jako mutacja tabel sgt_* (SQLite).
 * Odwzorowuje efekt, który w produkcji wykonałaby Sfera na bazie Subiekta:
 *  • set_location → UPDATE sgt_towar.lokalizacja,
 *  • MM → przesunięcie stanu magFrom→magTo + nadanie numeru dokumentu MM,
 *  • korekta zwrotu → dopisanie stanu do magazynu sprzedaży i MM na bufor.
 * Dzięki temu cały przepływ jest realny end-to-end w tym środowisku.
 */
export class DevSferaAdapter implements SferaAdapter {
  async applySetLocation(twId: number, newValue: string): Promise<void> {
    const res = db()
      .prepare("UPDATE sgt_towar SET lokalizacja = ? WHERE tw_id = ?")
      .run(newValue, twId);
    if (res.changes === 0) throw new Error(`Nie znaleziono towaru tw_id=${twId}`);
  }

  async applySetEan(twId: number, ean: string): Promise<void> {
    const res = db().prepare("UPDATE sgt_towar SET ean = ? WHERE tw_id = ?").run(ean, twId);
    if (res.changes === 0) throw new Error(`Nie znaleziono towaru tw_id=${twId}`);
  }

  /**
   * Korekta + MM w jednym. Kolejność jak w produkcji: najpierw stan wraca do
   * magazynu sprzedaży (skutek korekty), potem jedzie MM na bufor.
   *
   * Wycofania korekty przy padzie MM nie trzeba tu pisać ręką — całość idzie
   * w JEDNEJ transakcji SQLite, więc wyjątek cofa oba skutki naraz. Sfera
   * takiej transakcji nie ma i tam wycofanie jest jawnym `Usun()`; różnica
   * mieszka w implementacjach, kontrakt widzi to samo.
   */
  async createKorektaZwrotu(z: ZlecenieKorekty): Promise<WynikKorekty> {
    const d = db();
    let numery: WynikKorekty = { korektaNumer: "", mmNumer: "" };
    const tx = transaction(d, () => {
      const sprzedaz = d
        .prepare("SELECT dok_id FROM sgt_sprzedaz WHERE dok_id = ?")
        .get(z.dokId);
      if (!sprzedaz) throw new Error(`Nie znaleziono dokumentu sprzedaży dok_id=${z.dokId}`);
      for (const it of z.pozycje) {
        /* Dwa kroki, oba widoczne: korekta oddaje sztuki magazynowi sprzedaży,
           MM zabiera je stamtąd na bufor. Netto magazyn źródłowy wychodzi na
           zero i to jest POPRAWNE — towar nie ma być sprzedawalny ani chwili. */
        dopiszStan(it.twId, z.magZrodlowy, it.qty);
        zdejmijStan(it.twId, z.magZrodlowy, it.qty);
        dopiszStan(it.twId, z.magZwrotow, it.qty);
      }
      numery = {
        korektaNumer: nextKorektaNumber(z.typ),
        mmNumer: nextMmNumber(),
      };
    });
    tx();
    return numery;
  }

  async createMM(magFrom: number, magTo: number, items: MmItem[]): Promise<string> {
    const d = db();
    const tx = transaction(d, () => {
      for (const it of items) {
        zdejmijStan(it.twId, magFrom, it.qty);
        dopiszStan(it.twId, magTo, it.qty);
      }
    });
    tx();
    return nextMmNumber();
  }
}

/** Upsert stanu — magazyn docelowy nie musi mieć jeszcze wiersza. */
function dopiszStan(twId: number, magId: number, qty: number): void {
  const d = db();
  const jest = d.prepare("SELECT stan FROM sgt_stan WHERE tw_id = ? AND mag_id = ?").get(twId, magId);
  if (jest) {
    d.prepare("UPDATE sgt_stan SET stan = stan + ? WHERE tw_id = ? AND mag_id = ?").run(qty, twId, magId);
  } else {
    d.prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,0)").run(twId, magId, qty);
  }
}

function zdejmijStan(twId: number, magId: number, qty: number): void {
  const d = db();
  const from = d.prepare("SELECT stan FROM sgt_stan WHERE tw_id = ? AND mag_id = ?").get(twId, magId) as
    | { stan: number }
    | undefined;
  if (!from) throw new Error(`Brak stanu źródłowego tw_id=${twId}`);
  if (from.stan < qty) {
    throw new Error(`Za mało w magazynie źródłowym dla tw_id=${twId}: ${from.stan} < ${qty}`);
  }
  d.prepare("UPDATE sgt_stan SET stan = stan - ? WHERE tw_id = ? AND mag_id = ?").run(qty, twId, magId);
}
