import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlRoszczenProwizji, zapytajAllegro } from "../adapters/allegro.http.js";
import { kontoKanalu } from "./kanal-konto.js";

/* ── Wnioski o rabat transakcyjny (0.164.0) ──────────────────────────────────
   Zwrot prowizji od sprzedaży. Odczyt istnieje po to, żeby panel wiedział,
   przy którym zwrocie wniosek już jest — a firma klikała dotąd w panelu
   Allegro przy KAŻDYM, bo skąd inąd tego nie widziała.

   BEZ KURSORA I BEZ WŁASNEGO STANU, w odróżnieniu od zwrotów. Kursor tamtej
   listy pilnuje, żeby nie przewijać jej od początku przy tysiącach rekordów;
   tutaj interesują nas wnioski żyjące obok otwartych zwrotów, więc bierzemy
   kilka pierwszych stron i tyle. Kiedy okaże się, że to za mało, wzorzec
   z `allegro-zwroty-sync.ts` stoi obok gotowy — dokładanie maszynerii przed
   pierwszą potrzebą kosztowałoby więcej, niż daje.

   Prowizja przyjeżdża LICZBĄ, gdy Allegro wszędzie indziej oddaje kwotę
   tekstem (`docs/allegro-ksztalt.md`). Dlatego NIE idzie przez `naGrosze`,
   które liczy na tekście.                                                   */

const NA_STRONE = 100;
const MAKS_STRON = 5;

type Wniosek = {
  id?: string;
  status?: string;
  type?: string;
  quantity?: number;
  createdAt?: string;
  commission?: { amount?: number; currency?: string };
  lineItem?: { id?: string; offer?: { id?: string } };
};

export interface RabatySyncDeps {
  database?: Db;
  query?: typeof zapytajAllegro;
  now?: () => Date;
  apiUrl?: string;
  accountId?: string;
}

/** Prowizja na grosze. Wejście jest LICZBĄ — zaokrąglamy, nie parsujemy. */
export function prowizjaNaGrosze(amount: number | undefined): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

/** Jeden przebieg. Sieć kończy się PRZED transakcją, jak przy zwrotach. */
export async function synchronizujAllegroRabaty(deps: RabatySyncDeps = {}): Promise<void> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;

  const zebrane: Wniosek[] = [];
  for (let strona = 0; strona < MAKS_STRON; strona++) {
    const body = await query(urlRoszczenProwizji(apiUrl, strona * NA_STRONE)) as
      Record<string, unknown>;
    const partia = Array.isArray(body?.refundClaims)
      ? (body.refundClaims as Wniosek[]) : [];
    zebrane.push(...partia.filter((w) => typeof w?.id === "string"));
    if (partia.length < NA_STRONE) break;
  }

  const at = now().toISOString();
  transaction(database, () => {
    const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
    for (const w of zebrane) {
      /* Upsert po identyfikatorze wniosku: ta tabela jest LUSTREM Allegro,
         więc powtórny przebieg ma odświeżać wiersz, a nie mnożyć wnioski. */
      database.prepare(`INSERT INTO allegro_rabat
        (channel_account_id,external_id,line_item_id,offer_id,ilosc,
         prowizja_grosze,waluta,status,typ,created_at,synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
          line_item_id=excluded.line_item_id, offer_id=excluded.offer_id,
          ilosc=excluded.ilosc, prowizja_grosze=excluded.prowizja_grosze,
          waluta=excluded.waluta, status=excluded.status, typ=excluded.typ,
          created_at=excluded.created_at, synced_at=excluded.synced_at`).run(
        konto, w.id!, w.lineItem?.id ?? null, w.lineItem?.offer?.id ?? null,
        typeof w.quantity === "number" ? w.quantity : null,
        prowizjaNaGrosze(w.commission?.amount), w.commission?.currency ?? null,
        w.status ?? null, w.type ?? null, w.createdAt ?? null, at);
    }
  })();
}
