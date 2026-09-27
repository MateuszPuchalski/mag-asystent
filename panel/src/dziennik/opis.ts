/* ── „Co się stało" jednym zdaniem z danych wpisu (0.540.0) ─────────────
   Szczegół wpisu był surowym JSON-em pod „szczegóły". Żeby wiedzieć, że
   zapis nie wszedł, bo kartoteka była w edycji, trzeba było kliknąć
   i przeczytać `{"queueId":8,"proby":3,"blad":…}`.

   WŁASNE ZDANIE DLA TYPÓW, KTÓRE CZYTA SIĘ NAJCZĘŚCIEJ: kolektor, dostawy,
   zapisy do Subiekta i błędy. Reszta dostaje pary „klucz wartość" wprost
   z danych — mniej ładnie, ale nic nie ginie i nic nie jest zgadywane.

   ZDANIE NIE ZASTĘPUJE DOWODU. Surowe dane stoją w dymku komórki i w CSV:
   dziennik jest śladem audytowym, a opis jest tylko jego odczytem. Pole,
   którego opis nie zna, nie wywraca go, tylko wypada z tej wersji zdania. */

type Dane = Record<string, unknown>;

const tekst = (v: unknown): string =>
  v == null || v === "" ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
const szt = (v: unknown) => (v == null ? "" : `${tekst(v)} szt.`);
const cytat = (v: unknown) => (v == null || v === "" ? "" : `„${tekst(v)}”`);
/** Zdanie z kawałków — puste odpadają, reszta łączy się kropką środkową. */
const zloz = (...k: string[]) => k.filter(Boolean).join(" · ");

const OPISY: Record<string, (d: Dane) => string> = {
  scan: (d) => zloz(tekst(d.code), d.kind === "LOC" ? "półka" : d.kind === "EAN" ? "kod kreskowy" : ""),
  manual_entry: (d) => zloz(tekst(d.code), d.screen ? `ekran ${tekst(d.screen)}` : ""),
  search: (d) => cytat(d.q),
  location_set: (d) => zloz(tekst(d.result ?? d.value),
    d.action === "replace" ? "zamiast poprzedniej" : d.action === "add" ? "dopisana" : ""),
  location_removed: (d) => zloz(`zdjęta ${tekst(d.value)}`, d.result ? `zostaje ${tekst(d.result)}` : ""),
  location_mismatch: (d) => `miała być ${tekst(d.expected)}, jest ${tekst(d.actual)}`,
  przesuniecie: (d) => zloz(szt(d.qty), `${tekst(d.kodFrom)} → ${tekst(d.kodTo)}`, tekst(d.location)),
  putaway_line_done: (d) => zloz(szt(d.qty), d.lineId != null ? `pozycja ${tekst(d.lineId)}` : ""),
  ean_conflict: (d) => `${tekst(d.ean)} → ${Array.isArray(d.candidates) ? d.candidates.join(", ") : ""}`,
  ean_conflict_autoresolved: (d) => `${tekst(d.ean)} → ${Array.isArray(d.candidates) ? d.candidates.join(", ") : ""}`,
  problem_raised: (d) => zloz(d.typ === "damaged" ? "uszkodzenie" : d.typ === "missing" ? "brak" : tekst(d.typ),
    d.lineId != null ? `pozycja ${tekst(d.lineId)}` : ""),
  problem_resolved: (d) => (d.problemId != null ? `problem nr ${tekst(d.problemId)}` : ""),
  device_drop: (d) => zloz(d.g != null ? `${tekst(d.g).replace(".", ",")} g` : "", d.bateria != null ? `bateria ${tekst(d.bateria)}%` : ""),
  http_rejected: (d) => zloz(`${tekst(d.method)} ${tekst(d.url)}`, d.status != null ? `odpowiedź ${tekst(d.status)}` : ""),
  klient_odrzucona: (d) => zloz(tekst(d.powod), tekst(d.rodzaj)),
  queue_failed: (d) => zloz(d.proby != null ? `${tekst(d.proby)} próby` : "", cytat(d.blad)),
  queue_retry: (d) => zloz(d.proba != null ? `próba ${tekst(d.proba)} z ${tekst(d.max)}` : "", cytat(d.blad)),
  queue_applied: (d) => (d.docNo ? `dokument ${tekst(d.docNo)}` : ""),
  delivery_open: (d) => (d.deliveryId != null ? `dostawa nr ${tekst(d.deliveryId)}` : ""),
  delivery_done: (d) => (d.deliveryId != null ? `dostawa nr ${tekst(d.deliveryId)}` : ""),
  przesylka_zapisana: (d) => zloz(d.deliveryId != null ? `dostawa nr ${tekst(d.deliveryId)}` : "",
    d.kurierProtokol === "tak" ? "z protokołem kuriera" : ""),
  login: (d) => zloz(d.login ? `login ${tekst(d.login)}` : "", d.role ? `rola ${tekst(d.role)}` : ""),
  login_failed: (d) => cytat(d.login),
  user_created: (d) => zloz(d.userId != null ? `konto nr ${tekst(d.userId)}` : "", tekst(d.role)),
  user_active_changed: (d) => zloz(d.userId != null ? `konto nr ${tekst(d.userId)}` : "", d.active ? "włączone" : "wyłączone"),
  user_haslo_changed: (d) => zloz(d.userId != null ? `konto nr ${tekst(d.userId)}` : "", d.wlasne ? "własne" : "przez administratora"),
  audyt_eksport: (d) => (d.wierszy != null ? `${tekst(d.wierszy)} wierszy` : ""),
  magazyny_widocznosc: (d) => (Array.isArray(d.kody) && d.kody.length ? `ukryte: ${d.kody.join(", ")}` : "wszystkie widoczne"),
  privileged: (d) => tekst(d.operacja).replace(/_/g, " "),
};

/** Pary „klucz wartość" dla typów bez własnego zdania; puste pola odpadają. */
function pary(d: Dane): string {
  return Object.entries(d)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k} ${typeof v === "string" ? cytat(v) : tekst(v)}`)
    .join(" · ");
}

/** Dane wpisu jako obiekt; nie-JSON i nie-obiekt wracają jako `null`. */
function odczytaj(payload: string | null): Dane | null {
  if (!payload) return null;
  try {
    const d: unknown = JSON.parse(payload);
    return d && typeof d === "object" && !Array.isArray(d) ? d as Dane : null;
  } catch {
    return null;
  }
}

/** Najwyżej tyle znaków — reszta jest w dymku i w CSV (160 jak w biurze). */
const SUFIT = 160;

/**
 * Opis wpisu jednym wierszem. Pusty napis znaczy „wpis nie ma danych";
 * dane nie w JSON-ie wracają surowe, przycięte do sufitu.
 */
export function opisZdarzenia(typ: string, payload: string | null): string {
  const d = odczytaj(payload);
  if (!d) return (payload ?? "").slice(0, SUFIT);
  const wlasny = OPISY[typ];
  const opis = (wlasny ? wlasny(d) : "") || pary(d);
  return opis.length > SUFIT ? `${opis.slice(0, SUFIT - 1)}…` : opis;
}
