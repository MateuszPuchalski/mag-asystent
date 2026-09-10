import React from "react";
import { Sparkles } from "lucide-react";
import { Przycisk, czas } from "../ui";
import { ProcesCopilota } from "./ProcesCopilota";
import type { StanCopilota, SzkicCopilota } from "../api/typy";

/**
 * Szkic odpowiedzi z Copilota (§14.6, 0.231.0) — przycisk i karta pod edytorem.
 *
 * Propozycja modelu NIE wchodzi do pola sama. Stoi obok jako karta, a do
 * szkicu agenta trafia na jedno z dwóch kliknięć: „Wstaw" DOPISUJE (ten sam
 * kontrakt, co każda wstawka: nowa linia, nigdy ciche nadpisanie), „Zastąp"
 * jest jedyną świadomą drogą nadpisania i pojawia się TYLKO, gdy jest co
 * nadpisać. Każde kliknięcie, także „Odrzuć", jest werdyktem — z tych
 * werdyktów liczy się, czy przycisk wart jest pieniędzy.
 *
 * Bez kroku „to kosztuje": klik w jednej rozmowie JEST intencją. Partia nad
 * kolejką miała potwierdzenie, bo była kroplówką na dwadzieścia rozmów naraz.
 */
export interface PropsSzkicuCopilota {
  /** `undefined` = stan jeszcze nie przyszedł — wtedy nie ma ani przycisku, ani zdania. */
  stan: StanCopilota | undefined;
  szkic: SzkicCopilota | null;
  /** Klient dopisał po tym, jak szkic powstał — propozycja odpowiada na stare pytanie. */
  nieswiezy: boolean;
  /** Bieżąca wersja doboru; inna niż w szkicu = fakty się zmieniły od szkicu. `null` = nieznana. */
  doborWersja: number | null;
  /** Nazwy pól doboru, które Copilot rozpoznał w rozmowie, a agent jeszcze nie ma (liczy `propozycjaDoboru`). */
  nowePolaDoboru: string[];
  /** Para „X → Y" rozpoznana w rozmowie, jeszcze bez decyzji agenta (liczy `paraPasowania`). */
  paraPasowania: string | null;
  uklada: boolean;
  blad: string;
  /** Szkic agenta jest niepusty — dopiero wtedy „Zastąp" ma sens. */
  maSzkicAgenta: boolean;
  wylaczony: boolean;
  onUloz: () => void;
  onWstaw: () => void;
  onZastap: () => void;
  onOdrzuc: () => void;
}

/**
 * Copilot W JEDNEJ LINII, bez własnego rzędu (0.249.0).
 *
 * Zgłoszenie właściciela: „niepotrzebnie ułóż odpowiedź i add attachment mają
 * swój własny rząd". Miał rację — dwa rzędy szły na dwie rzeczy, z których
 * jedna jest pomocą przy pisaniu, a druga czynnością od święta.
 *
 * 0.247.0 próbowało już wciągnąć ten przycisk do rzędu przełącznika trybu
 * i zostało WYCOFANE, bo z Copilotem wyłączonym komponent renderuje ZDANIE
 * z serwera, nie przycisk, a zdanie łamało rząd na dwa wiersze. Wycofanie
 * leczyło objaw. Przyczyną było to, że jeden komponent zwracał raz przycisk,
 * raz akapit — więc wołający nie miał jak wiedzieć, ile miejsca zajmie.
 *
 * Teraz nie zajmuje NIGDY więcej niż jedną linię: zdanie się ucina, a całość
 * zostaje w podpowiedzi. `truncate` wymaga `min-w-0` u rodzica we flexie.
 */
export function PrzyciskSzkicu({ p }: { p: PropsSzkicuCopilota }) {
  if (!p.stan) return null;
  if (!p.stan.wlaczony) {
    /* Przycisk, który nie może zadziałać, uczy nie klikać — zamiast niego
       zdanie z serwera, ale skrócone do jednej linii. */
    return <span className="min-w-0 truncate text-xs text-slate-400" title={p.stan.powod ?? undefined}>
      {p.stan.powod}</span>;
  }
  return <span className="flex min-w-0 items-center gap-2">
    <Przycisk className="shrink-0 text-xs" disabled={p.uklada || p.wylaczony} onClick={p.onUloz}>
      <Sparkles size={14} />{p.uklada ? "Układam szkic z faktów…" : "Ułóż odpowiedź"}</Przycisk>
    {p.blad && <span className="min-w-0 truncate text-xs text-red-700" title={p.blad}>{p.blad}</span>}
  </span>;
}

export function KartaSzkicu({ p }: { p: PropsSzkicuCopilota }) {
  const s = p.szkic;
  /* Oceniony szkic zniknął z ekranu: wstawiony już jest w polu, odrzucony
     nie ma po co wisieć. Wiersz w bazie zostaje dla pomiaru. */
  if (!s || s.ocena !== null) return null;
  /* PRZYCISKI NA GÓRZE, TREŚĆ PRZEWIJA SIĘ SAMA (0.232.1). Karta stoi
     wewnątrz edytora, który jest `shrink-0`; długi szkic rozpychał go tak, że
     oś rozmowy zwijała się do jednej linii, a dół karty — z przyciskami —
     ginął pod krawędzią kolumny. Zrzut właściciela z 8.09.2026. Przycisk,
     którego nie widać, nie istnieje, a dół jest tym, co ginie pierwsze. */
  return <section className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3" aria-label="Szkic Copilota">
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <b className="text-violet-900"><Sparkles size={12} className="inline" /> Szkic Copilota</b>
      <span className="text-slate-500">{s.model} · {czas(s.at)} · {s.przez}</span>
      {p.nieswiezy && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
        powstał przed nową wiadomością klienta</span>}
      {/* Drugi rodzaj nieświeżości (przyrost trzeci): dane doboru zmieniły się
          po szkicu — zwykle dlatego, że agent właśnie wpisał to, co Copilot
          rozpoznał. Fakty są inne, więc szkic trzeba ułożyć jeszcze raz.
          Zero w szkicu = wiersz sprzed migracji, o którym nic nie wiemy. */}
      {p.doborWersja !== null && s.doborWersja > 0 && s.doborWersja !== p.doborWersja &&
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
          dane doboru zmieniły się od szkicu — ułóż ponownie</span>}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <Przycisk wariant="glowny" className="text-xs" disabled={p.wylaczony} onClick={p.onWstaw}>Wstaw do szkicu</Przycisk>
        {p.maSzkicAgenta && <Przycisk className="text-xs" disabled={p.wylaczony} onClick={p.onZastap}>Zastąp szkic</Przycisk>}
        <Przycisk className="text-xs" onClick={p.onOdrzuc}>Odrzuć</Przycisk>
      </span>
    </div>
    <div className="max-h-56 overflow-y-auto" data-testid="szkic-copilota-tresc">
      {/* Bez drugiego przycisku „Wpisz": dane wpisuje się tam, gdzie stoją —
          w zakładce Dobór. Tu tylko zdanie, żeby agent wiedział, że są. */}
      {p.nowePolaDoboru.length > 0 && <p className="mb-2 rounded border border-violet-200 bg-white p-2 text-xs text-violet-900">
        Copilot rozpoznał w rozmowie: {p.nowePolaDoboru.join(", ")} — wpisz je w zakładce Dobór.</p>}
      {/* Para z rozmowy (przyrost czwarty) tą samą zasadą: zdanie tu, kliknięcie w Doborze. */}
      {p.paraPasowania && <p className="mb-2 rounded border border-violet-200 bg-white p-2 text-xs text-violet-900">
        Copilot rozpoznał pasowanie {p.paraPasowania} — zaproponuj je w zakładce Dobór.</p>}
      {s.zastrzezenia.length > 0 && <ul className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
        aria-label="Czego model nie znalazł w faktach">
        {s.zastrzezenia.map((z, i) => <li key={i}>⚠ {z}</li>)}
      </ul>}
      <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{s.tresc}</pre>
    </div>
    {/* Rachunek POD tekstem, nie w nim (0.253.0): klient ma dostać gładką
        odpowiedź, a agent — to, na czym ona stoi. Klucz z czasu szkicu, żeby
        nowy szkic otwierał okno od nowa wg własnych twierdzeń. */}
    <ProcesCopilota key={s.at} twierdzenia={s.twierdzenia} />
    {/* OKAZJA, NIE BŁĄD (0.254.0). Oferta wymienia oznaczenia, których nasza
        kartoteka nie zna — właściciel nazwał to „organiczną okazją do
        uzupełnienia danych", bo obie listy stoją tu obok siebie pierwszy
        i jedyny raz. Pasek jest dla AGENTA: do faktów ta lista nie wchodzi,
        więc klient nie ma jak jej zobaczyć. */}
    {s.lukiKartoteki.length > 0 &&
      <p className="mt-2 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900"
        data-testid="luki-kartoteki">
        W ofercie są oznaczenia, których nie ma w kartotece: <b>{s.lukiKartoteki.join(", ")}</b>
        {" "}— okazja, żeby je dopisać.
      </p>}
    <p className="mt-1 text-[11px] text-slate-500">{s.tresc.length} znaków · każde twierdzenie ma podpisane źródło</p>
  </section>;
}
