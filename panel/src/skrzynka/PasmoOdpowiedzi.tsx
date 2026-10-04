import React from "react";
import type { KartaTowaru, OsRozmowy } from "../api/typy";
import { useKartaTowaru } from "../api/rozmowy";
import { EtykietaWartosci, dzien } from "../ui";

/* ── PASMO ODPOWIEDZI ────────────────────────────────────────────────────────
   Zgłoszenie właściciela ze zrzutem: „popraw skrzynkę odpowiadania pytań".

   Prawa kolumna wie wszystko i nie mówi nic pierwsza. Przy pytaniu „przyszły
   nie te prowadnice co trzeba" rozstrzygają TRZY fakty: co klient zamówił,
   czym to jest u nas i czy to mamy. Leżały wśród około czterdziestu innych,
   w tej samej wadze, a stan i półka dopiero po przewinięciu sześciu sekcji.

   TRZY WIERSZE, NIE SKRÓT WSZYSTKIEGO. Czwarty wiersz zaczyna być drugą
   kolumną, a wtedy pasmo przestaje być pasmem. Dekalog ergonomii, punkt 2:
   pierwszeństwo ma to, co rozstrzyga bieżącą czynność.

   „ZAMÓWIŁ" BEZ DATY. Datę zakupu mówi krok „Złożone" w karcie zakupu i linia
   osi rozmowy. Wiersz zostaje mimo karty, bo karta bywa poza kadrem, a ilość
   z sygnaturą rozstrzyga odpowiedź tak samo jak stan.

   NAD WIERSZAMI KOLUMNY, poza jej przewijaniem: te fakty są odpowiedzią na
   pytanie z rozmowy, a nie zawartością kartoteki, i mają zostać w kadrze, gdy
   agent rozwinie „Dobór" albo „Klienta".

   Wiersz, którego nie mamy z czego złożyć, nie staje: bez potwierdzonej
   kartoteki nie ma „To jest" ani „Mamy". Pusta etykieta udawałaby brak towaru
   zamiast braku wiedzy, a „wczytuję…" mówi wprost, że wiedza jest w drodze.

   BEZ WSTAWKI (22 września 2026, decyzja właściciela). Wiersz „Mamy" niósł
   kiedyś „wstaw do szkicu". Szkic Copilota czeka dziś przy każdej
   wiadomości i układa odpowiedź z tych samych faktów, więc wstawka dublowała
   treść w polu. Pasmo zostaje, bo agent sprawdza szkic właśnie z tymi
   trzema faktami przed oczami.                                              */

/** Jeden wiersz pasma; bez wartości nie rysuje się wcale. */
function Wiersz({ etykieta, children }: { etykieta: string; children: React.ReactNode }) {
  return <div className="flex items-baseline gap-2 text-sm">
    <EtykietaWartosci className="w-16 shrink-0">{etykieta}</EtykietaWartosci>
    <span className="min-w-0 flex-1 text-slate-900">{children}</span>
  </div>;
}

/**
 * Dopisek do „Mamy" o dostawach (0.502.0) — w TYM wierszu, nie w czwartym,
 * bo pasmo ma trzy wiersze (nagłówek pliku). Serwer liczył to dla kolektora,
 * a agent pytany „kiedy będzie" szedł po termin do Subiekta.
 *
 * Przy braku mówi, co jest zamówione i na kiedy; przy stanie — ile z niego
 * stoi jeszcze w przyjęciach, bo „mamy 12" z pustą półką to paczka, która
 * dziś nie wyjdzie. Dostawca i numer dokumentu są tu wolno: pasmo czyta
 * agent, nie klient (szkic Copilota ich nie dostaje).
 */
export function dopisekDostaw(karta: KartaTowaru): string | null {
  const jedn = karta.unit ?? "szt.";
  if (karta.mag.avail <= 0) {
    if (!karta.zamowione) return null;
    const z = karta.zamowione[0];
    if (!z) return "nic nie zamówione u dostawcy";
    const ile = karta.zamowione.reduce((a, b) => a + b.ilosc, 0);
    return `zamówione ${z.szacunek ? "do " : ""}${ile} ${jedn}`
      + (z.dostawca ? ` u ${z.dostawca}` : "")
      + (z.termin ? `, termin ${dzien(z.termin)}` : ", bez terminu")
      + (karta.zamowione.length > 1 ? ` (${karta.zamowione.length} zamówienia)` : "");
  }
  const wPrzyjeciach = (karta.wDostawie ?? []).reduce((a, b) => a + b.ilosc, 0);
  return wPrzyjeciach > 0 ? `w tym ${wPrzyjeciach} ${jedn} w przyjęciach, jeszcze nie na półce` : null;
}

export function PasmoOdpowiedzi({ dane }: { dane: OsRozmowy }) {
  const oferta = dane.oferta;
  const k = oferta?.kartoteka;
  /* Ta sama zasada, co w `TowarRozmowy`: pasmo mówi o kartotece POTWIERDZONEJ.
     Propozycja jest do zatwierdzenia przez człowieka i nie ma prawa stanąć
     w paśmie jako fakt (§4.3, §11.3). */
  const potwierdzona = k && (k.pewnosc === "pamiec" || k.pewnosc === "sku") ? k.twId : null;
  /* To samo zapytanie, co w sekcji „Subiekt GT" niżej — TanStack trzyma je pod
     jednym kluczem, więc kolumna nie pyta serwera dwa razy. */
  const karta = useKartaTowaru(potwierdzona);

  /* Pozycja paragonu dotycząca TEJ oferty: z niej bierze się ilość i sygnatura
     z chwili zakupu. Zamówienie bywa kilkupozycyjne, a pytanie dotyczy jednej
     rzeczy. */
  const pozycja = dane.zamowienie?.pobrane?.pozycje
    .find((p) => p.offerId !== null && p.offerId === oferta?.externalId) ?? null;

  const zamowil = pozycja
    ? `${pozycja.ilosc} × ${pozycja.sku ?? pozycja.offerId ?? "bez sygnatury"}`
    : null;
  /* Sygnatura, którą agent już widzi: z pozycji zamówienia, a bez zamówienia
     z oferty. Karta zakupu nad osią pokazuje tę samą, więc symbol kartoteki
     równy jej byłby powtórzeniem. */
  const sygnatura = pozycja?.sku ?? oferta?.pobrana?.sku ?? null;

  /* Pasmo bez ani jednego wiersza to pasek bez treści, czyli koszt bez
     pożytku. Rozmowa bez zamówionej pozycji i bez potwierdzonej kartoteki
     nie dostaje go wcale. */
  if (!zamowil && potwierdzona === null) return null;

  /* WARTOŚCI ZAJMUJĄ WIERSZ OD PIERWSZEGO RENDERU. Gdy „To jest" i „Mamy"
     czekały na Subiekta, pasmo dorastało o 45 px pod okiem agenta i spychało
     kolumnę w chwili czytania. „wczytuję…" trzyma miejsce, a wiersz potem nie
     znika, tylko się wypełnia. To nie jest więc „ruch za nic", przez który
     puste wiersze „Klient" i „Wiedza" nie stają przed odczytem. */
  const d = karta.data;
  const czekam = <span className="text-slate-500">wczytuję…</span>;

  return <aside aria-label="Do tej odpowiedzi" aria-busy={karta.isLoading || undefined}
    /* gramatyka: pasmo stoi poza przewijaniem kolumny */
    className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
    <div className="flex flex-col gap-1">
      {zamowil && <Wiersz etykieta="Zamówił">
        <span className="font-mono font-semibold">{zamowil}</span>
      </Wiersz>}
      {potwierdzona !== null && <Wiersz etykieta="To jest">
        {d ? <>
          <span className="font-semibold">{d.name}</span>
          {/* Symbol tylko wtedy, gdy RÓŻNI SIĘ od sygnatury, którą agent już
              widzi. Równy powtarzał to samo słowo; różny to sygnał, że oferta
              wskazuje inną kartotekę, i ten zostaje. */}
          {d.sym && d.sym !== sygnatura && <span className="font-mono text-slate-600"> · {d.sym}</span>}
        </> : karta.isError ? <span className="text-ranga-zle">Subiekt nie odpowiedział</span> : czekam}
      </Wiersz>}
      {potwierdzona !== null && <Wiersz etykieta="Mamy">
        {d ? <>
          {/* Zero na stanie jest CZERWONE, nie wyciszone: to jedyny wiersz
              pasma, który sam z siebie zmienia treść odpowiedzi do klienta. */}
          <b className={d.mag.avail > 0 ? "text-ranga-ok" : "text-ranga-zle"}>
            {d.mag.avail > 0 ? `${d.mag.avail} ${d.unit ?? "szt."}` : "brak na stanie"}</b>
          {d.locs?.length ? <span className="font-mono text-slate-600">
            {" · "}{d.locs.join(", ")}</span> : null}
          {dopisekDostaw(d) && <span className="text-slate-700">{" · "}{dopisekDostaw(d)}</span>}
        </> : karta.isError ? <span className="text-slate-500">nie wiemy</span> : czekam}
      </Wiersz>}
    </div>
  </aside>;
}
