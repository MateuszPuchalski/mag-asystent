import type { DatabaseSync } from "node:sqlite";
import { chwilaUtc } from "../czas.js";
import { DOSYLKA_ZWROTU_SQL, jestKodemDosylki, OKNO_SLEDZENIA_MS, type KodDosylki } from "./dosylka-opis.js";

/* ── Odmowy wypłaty z kodem dosyłki, których nikt nie śledzi (@wydanie) ──────
   Biuro odmawia wypłaty w PANELU ALLEGRO (fakt właściciela z 27 września
   2026). Kod przychodzi wtedy synchronizacją, a zwrot schodzi do grupy
   „odrzucony”, poza kolejkę decyzji. Przycisk „Śledź dosyłkę” przy zwrocie
   i propozycja na profilu stały więc poza drogą, którą biuro chodzi — to
   wniosek z kodu, nie pomiar.

   JEDNA REGUŁA DLA DWÓCH MIEJSC. Profil pokazuje najświeższą odmowę klienta,
   „Do decyzji” wszystkie. Gdyby każde liczyło po swojemu, wiersz w „Do
   decyzji” zgasłby przy innej dosyłce niż propozycja na profilu.

   Okno ma trzydzieści dni, jak śledzenie. Chwila odmowy to nasza odmowa,
   potem odmowa według Allegro, potem zgłoszenie zwrotu — nigdy
   `zwrot_klienta.created_at`, bo tę datę składa synchronizacja. Bez żadnej
   daty odmowy nie da się umieścić w oknie, więc jej nie ma: stara odmowa
   podana jako świeża namawiałaby do śledzenia paczki sprzed miesięcy. */

export interface OdmowaBezDosylki {
  zwrotId: number;
  zamowienie: string;
  login: string;
  kod: KodDosylki;
  /** Nasza odmowa, a bez niej odmowa według Allegro — pole dla profilu. */
  odmowaAt: string | null;
  /** Chwila, po której odmowa stoi w oknie i w kolejności listy. */
  kiedy: string;
}

type Wiersz = Record<string, unknown>;
const tekst = (v: unknown): string | null => (v == null ? null : String(v));

const KOLUMNY = `SELECT z.id, z.order_id, z.channel_account_id, z.kupujacy_login, z.odmowa_kod,
    z.rejection_code, z.odmowa_at,
    json_extract(a.surowe_json, '$.rejection.createdAt') AS odrzucono_allegro,
    json_extract(a.surowe_json, '$.createdAt') AS zgloszono_allegro
  FROM zwrot_klienta z LEFT JOIN allegro_zwrot a ON a.id = z.external_id
  WHERE z.order_id IS NOT NULL AND z.kupujacy_login IS NOT NULL
    AND (z.odmowa_kod IN ('NEW_ITEM_SENT','MISSING_PART_SENT')
         OR z.rejection_code IN ('NEW_ITEM_SENT','MISSING_PART_SENT'))`;

/**
 * Odmowy z kodem dosyłki w oknie trzydziestu dni, bez dosyłki, która
 * należy do zwrotu (`DOSYLKA_ZWROTU_SQL` — ta sama reguła co przejęcie przy
 * odmowie). Najświeższe pierwsze. `login` zawęża do jednego klienta.
 */
export function odmowyBezDosylki(
  database: DatabaseSync, teraz: Date, login: string | null = null,
): OdmowaBezDosylki[] {
  /* Dwa zapytania zamiast `(? IS NULL OR login = ?)`: przy takim warunku
     SQLite nie sięgnie po indeks loginu, a profil pyta przy każdym otwarciu. */
  const kandydaci = (login === null
    ? database.prepare(KOLUMNY).all()
    : database.prepare(`${KOLUMNY} AND z.kupujacy_login = ? COLLATE NOCASE`).all(login)) as Wiersz[];
  const granica = teraz.getTime() - OKNO_SLEDZENIA_MS;
  const zwrotuDosylka = database.prepare(DOSYLKA_ZWROTU_SQL);
  return kandydaci.map((z) => {
    const kiedy = [z.odmowa_at, z.odrzucono_allegro, z.zgloszono_allegro]
      .map(tekst).find((v) => v !== null && Number.isFinite(chwilaUtc(v))) ?? null;
    return { z, kiedy, t: kiedy === null ? Number.NaN : chwilaUtc(kiedy) };
  })
    .filter((x) => Number.isFinite(x.t) && x.t >= granica)
    .filter((x) => !zwrotuDosylka.get(Number(x.z.id), Number(x.z.channel_account_id), String(x.z.order_id)))
    .sort((a, b) => b.t - a.t)
    .map(({ z, kiedy }) => ({
      zwrotId: Number(z.id),
      zamowienie: String(z.order_id),
      login: String(z.kupujacy_login),
      kod: jestKodemDosylki(z.odmowa_kod) ? z.odmowa_kod : z.rejection_code as KodDosylki,
      odmowaAt: z.odmowa_at == null ? tekst(z.odrzucono_allegro) : String(z.odmowa_at),
      kiedy: kiedy!,
    }));
}
