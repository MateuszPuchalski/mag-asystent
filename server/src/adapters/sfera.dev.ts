import { db, nextMmNumber, transaction } from "../db/db.js";
import type { MmItem, SferaAdapter } from "./sfera.js";
import { oznaczWSubiekcie, wlasneZdjecie } from "../services/zdjecia-wlasne.js";

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
   * Dodanie zdjęcia do kartoteki (0.88.0).
   *
   * W trybie demo nie ma bazy Subiekta ani tabeli `tw_ZdjecieTw`, więc jedynym
   * skutkiem jest ODDANIE ZDJĘCIA CACHE'OWI: wiersz w `zdjecie_wlasne` znika,
   * a kolejne wejście na kartę pyta źródła. Konfiguracja pilnuje, żeby przy
   * SGT_MODE=seeded stało ZDJECIA_DODAWANIE=wertis i to zadanie w ogóle nie
   * powstało — ta metoda jest tu po to, żeby kontrakt był kompletny, a nie
   * po to, żeby czymkolwiek udawać zapis do Subiekta.
   */
  async applySetZdjecie(twId: number): Promise<void> {
    if (!wlasneZdjecie(twId)) return;
    oznaczWSubiekcie(twId);
    db().prepare("DELETE FROM zdjecie_cache WHERE tw_id = ?").run(twId);
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
