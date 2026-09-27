import { useZdrowie } from "../api/rozmowy";
import type { Zdrowie } from "../api/typy";
import { godzina } from "../ui";

/* ── Stan synchronizacji w nagłówku (z pigułki 0.193.0, skrócony 0.538.0) ──
   Stoi w NAGŁÓWKU, a nie w skrzynce: agent ma go widzieć z każdej zakładki.
   Awaria integracji, o której wie tylko jeden ekran, jest awarią widoczną
   dopiero wtedy, gdy ktoś na ten ekran wejdzie.

   KROPKA I GODZINA ZAMIAST ZDANIA (0.538.0, decyzja właściciela z 27 września
   2026 — nagłówek w jednym rzędzie). Pełne zdanie zajmowało ~200 px, a przy
   1180 px jeden rząd nie ma ich skąd wziąć. W spokoju agent pyta tylko „czy
   żyje i jak świeże", a na to odpowiadają kolor i godzina. Liczba błędów
   została w dymku i w menu „Więcej" przy stanie systemu, jeden klik dalej.

   ALARM ZOSTAJE SŁOWEM, nie kolorem kropki: „Stanęła" czerwonym tekstem.
   Czerwona kropka wśród ośmiu zakładek to szczegół, który oko przeskakuje,
   a stojąca synchronizacja to dokładnie ten stan, którego przeoczyć nie wolno. */

/** Pełne zdanie o synchronizacji — dymek wskaźnika i wiersz w menu „Więcej". */
export function zdanieSynchronizacji(i: Zdrowie["allegroInbox"]): string {
  return i.alarm
    ? `Synchronizacja stanęła ${godzina(i.ostatniaUdanaSynchronizacja)}`
    : `Synchronizacja ${godzina(i.ostatniaUdanaSynchronizacja)} · ${i.liczbaBledow} błędów`;
}

export function WskaznikSynchronizacji() {
  const { data } = useZdrowie();
  if (!data) return null;
  const i = data.allegroInbox;
  const zle = i.status !== "current";
  const zdanie = zdanieSynchronizacji(i);
  return <span role="status" title={zdanie} aria-label={zdanie}
    className={`flex shrink-0 items-center gap-1.5 px-1 text-xs ${
      i.alarm ? "font-semibold text-red-300" : "text-slate-300"}`}>
    {/* W alarmie bez kropki: czerwone słowo mówi to samo, a 14 px kropki
        z odstępem to akurat tyle, ile brakowało, żeby menu nie spadało
        do drugiego rzędu właśnie wtedy, gdy synchronizacja stoi. */}
    {i.alarm ? `Stanęła ${godzina(i.ostatniaUdanaSynchronizacja)}` : <>
      <span className={`h-2 w-2 rounded-full ${zle ? "bg-red-400" : "bg-emerald-400"}`} />
      {godzina(i.ostatniaUdanaSynchronizacja)}</>}
  </span>;
}
