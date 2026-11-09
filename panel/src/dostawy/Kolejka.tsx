import React from "react";
import type { DokumentDostawy, ZamknietaPoza } from "../api/dostawy";
import { useLogoDostawcy } from "../towar/useZdjecie";
import { Pusto, WierszKolejki, czas, dataLokalna, dzien, ile } from "../ui";

/* ── Kolejka dostaw ────────────────────────────────────────────────────────
   - WIERSZ W DWÓCH LINIACH (dekalog pkt 2). Numer z dostawcą i wiekiem, pod
     nimi pasek z licznikiem. Stanu słowem (W TOKU, NIETKNIĘTA) nie ma, bo
     mówi to samo co pasek: 0/40 to nietknięta, 12/40 w toku.
   - W WIERSZU TYLKO SYGNAŁY, PO KTÓRE BIURO WCHODZI W DOKUMENT: otwarte
     wyjątki i nieprzeczytana odpowiedź z hali.
   - CZEKA NA BIURO jest KUBEŁKIEM, a nie grupą na górze listy: ta sama
     sprawa w dwóch miejscach listy to dwa kliknięcia do jednej rzeczy.
   - LOGO DOSTAWCY Z LEWEJ: firmę poznaje się wzrokiem, zanim przeczyta się
     numer. */

/* Miejsce na logo ma WYMIARY OD RAZU i stoi także przy dostawcy bez logo:
   nazwy zaczynają się wtedy w jednej kolumnie, a wiersz nie podskakuje
   w chwili doczytania obrazu.
   Pytamy wyłącznie o logo, które jest — `maLogo` przychodzi z listy, więc
   dostawca bez logo nie dobija serwera o 404. Obraz WYPEŁNIA miejsce
   (`object-contain`), a nie tylko się w nim mieści: `max-w-full` nie
   powiększa, więc małe logo stałoby kropką w rogu pustego pola.

   MIEJSCE STOI TYLKO WTEDY, GDY KTOKOLWIEK NA LIŚCIE MA LOGO. Równa kolumna
   nazw ma sens przy logo obok logo; bez żadnego logo byłoby to 56 px pustki
   przed każdym numerem. */
function LogoWiersza({ d }: { d: DokumentDostawy }) {
  const url = useLogoDostawcy(d.khId, d.maLogo);
  return <span className="flex h-8 w-14 shrink-0 items-center" aria-hidden="true">
    {url && <img src={url} alt="" className="h-full w-full object-contain object-left" />}
  </span>;
}

export type KubelekDostaw = "decyzja" | "toku" | "nietkniete" | "zamkniete" | "poza" | "archiwum";

export const KUBELKI_DOSTAW: Array<{ id: KubelekDostaw; etykieta: string; pytanie: string }> = [
  { id: "decyzja", etykieta: "Do decyzji", pytanie: "Reklamować u dostawcy czy zamknąć wyjątki?" },
  { id: "toku", etykieta: "W toku", pytanie: "Tylko wgląd — hala rozkłada." },
  { id: "nietkniete", etykieta: "Nietknięte", pytanie: "Tylko wgląd — nikt jeszcze nie zaczął." },
  { id: "zamkniete", etykieta: "Zamknięte", pytanie: "Tylko wgląd." },
  /* Pytanie „poza WERTIS" jest jedynym, na które odpowiada się przyciskiem
     na tej liście — cała karta istniała w biurze po to, żeby pomyłkowe
     zamknięcie dało się zauważyć i cofnąć. */
  { id: "poza", etykieta: "Poza WERTIS", pytanie: "Zdjęte z listy decyzją biura — pomyłka? Przywróć." },
  { id: "archiwum", etykieta: "Archiwum", pytanie: "Tylko wgląd — dostawy spoza okna importu." },
];

/**
 * Do którego kubełka należy dokument z okna importu.
 *
 * DO DECYZJI PRZEBIJA STAN. Wyjątek liczy się jako pozycja domknięta (D8),
 * więc faktura z trzema reklamacjami bywa „zamknięta" — a dalej czeka na
 * biuro. Gdyby o kubełku decydował status, wypadłaby z pracy do historii.
 */
export function kubelekDokumentu(d: DokumentDostawy, zOdpowiedzia: Set<number>): KubelekDostaw {
  if (d.wyjatkiOtwarte > 0 || zOdpowiedzia.has(d.dokId)) return "decyzja";
  if (d.status === "done") return "zamkniete";
  if (d.status === "open") return "toku";
  return "nietkniete";
}

/**
 * Liczba wyjątków słowami — JEDNO brzmienie na liście i w dokumencie. Tu
 * liczy się zawsze OTWARTE zgłoszenia i mówi się to wprost; inna liczba pod
 * tym samym słowem wprowadzałaby w błąd.
 */
export const otwarteWyjatki = (n: number) => ile(n, "otwarty wyjątek", "otwarte wyjątki", "otwartych wyjątków");

/**
 * Wiek dokumentu słowami — od daty wystawienia, bo tylko ją lista zna.
 *
 * W DNIACH KALENDARZA, NIE W GODZINACH. Data wystawienia nie ma godziny,
 * a liczenie od niej milisekund dałoby „11 g 51 min" przy fakturze z dzisiaj
 * — dokładność, której dane nie mają, liczoną w dodatku od północy UTC.
 */
export function wiekDokumentu(data: string, teraz = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data ?? "");
  if (!m) return "—";
  const [r, mies, dz] = dataLokalna(teraz.toISOString()).split("-").map(Number);
  const dni = Math.round((Date.UTC(r, mies - 1, dz) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86_400_000);
  if (dni <= 0) return "dziś";
  if (dni === 1) return "wczoraj";
  return `${dni} dni`;
}

/**
 * Pasek rozłożenia. ZIELEŃ TYLKO DLA SKOŃCZONEGO BEZ ZASTRZEŻEŃ: wyjątek
 * liczy się jako pozycja domknięta (D8), więc zielony pasek przy otwartych
 * wyjątkach mówiłby „gotowe", a plakietka obok „czeka na ciebie". Wygrywa
 * kolor, bo zajmuje więcej miejsca. Przy otwartym wyjątku pasek zostaje
 * bursztynowy.
 */
function Pasek({ zrobione, wszystkie, czeka }: { zrobione: number; wszystkie: number; czeka: boolean }) {
  const proc = wszystkie ? Math.min(100, Math.round((zrobione / wszystkie) * 100)) : 0;
  return <div className="mt-1 flex items-center gap-2">
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
      <div className={`h-1.5 ${proc >= 100 && !czeka ? "bg-emerald-600" : "bg-wertis-amber"}`} style={{ width: `${proc}%` }} />
    </div>
    <span className="text-xs tabular-nums text-slate-600">{zrobione}/{wszystkie}</span>
  </div>;
}

/* Rama wiersza mieszka w `ui/` — kosze używają tej samej. */
const Wiersz = WierszKolejki;

export function KolejkaDostaw({ dokumenty, zOdpowiedzia, wybrany, onWybierz, pusto }: {
  dokumenty: DokumentDostawy[];
  zOdpowiedzia: Set<number>;
  wybrany: number | null;
  onWybierz: (dokId: number) => void;
  pusto: string;
}) {
  /* Pusty napis = nic nie mówić: w DO DECYZJI nad listą stoją wtedy wiersze
     spoza okna importu, a „nic nie czeka" pod nimi przeczyłoby im. */
  if (!dokumenty.length) return pusto ? <Pusto waga="lista">{pusto}</Pusto> : null;
  const zLogo = dokumenty.some((d) => d.maLogo);
  return <ul className="divide-y divide-slate-200">
    {dokumenty.map((d) => {
      const wszystkie = d.linesTotal || d.positions;
      return <Wiersz key={d.dokId} aktywny={d.dokId === wybrany} onKlik={() => onWybierz(d.dokId)}>
        <span className="flex w-full items-start gap-3">
          {zLogo && <LogoWiersza d={d} />}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex w-full items-baseline gap-2">
              <span className="truncate font-bold">{d.nrPelny}</span>
              <span className="ml-auto shrink-0 text-xs text-slate-600" title={`wystawiona ${dzien(d.dataWyst)}`}>
                {wiekDokumentu(d.dataWyst)}</span>
            </span>
            <span className="w-full truncate text-sm text-slate-600">
              {d.dostawca} · {ile(wszystkie, "pozycja", "pozycje", "pozycji")}</span>
            {/* Własna linia, nie dopisek do dostawcy: przy długiej nazwie
                obcięcie zjadłoby właśnie numer, z którym biuro reklamuje. */}
            {d.nrDostawcy && <span className="w-full truncate text-sm text-slate-600">
              faktura dostawcy {d.nrDostawcy}</span>}
            <span className="w-full"><Pasek zrobione={d.linesDone} wszystkie={wszystkie}
              czeka={d.wyjatkiOtwarte > 0} /></span>
            {(zOdpowiedzia.has(d.dokId) || d.wyjatkiOtwarte > 0) &&
              <span className="mt-1 flex flex-wrap gap-1.5">
                {zOdpowiedzia.has(d.dokId) &&
                  <span className="rounded bg-stan-open px-1.5 py-0.5 text-xs font-bold text-stan-open-tekst">
                    odpowiedź z hali</span>}
                {d.wyjatkiOtwarte > 0 &&
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">
                    {otwarteWyjatki(d.wyjatkiOtwarte)}</span>}
              </span>}
          </span>
        </span>
      </Wiersz>;
    })}
  </ul>;
}

/**
 * Otwarte wyjątki, których dokumentu nie ma na liście — spoza okna importu
 * albo bez dostawy w ogóle. Muszą mieć własny wiersz, bo lista dostaw ich nie zna,
 * a zgłoszenie, którego nie widać, to zgłoszenie zgubione.
 */
export function WierszeSpozaOkna({ grupy, wybrany, onWybierz }: {
  grupy: Array<{ dokId: number | null; nr: string; ile: number }>;
  wybrany: number | "bez" | null;
  onWybierz: (dokId: number | "bez") => void;
}) {
  if (!grupy.length) return null;
  return <ul className="divide-y divide-slate-200 border-b border-slate-200">
    {grupy.map((g) => {
      const klucz = g.dokId ?? "bez";
      return <Wiersz key={String(klucz)} aktywny={wybrany === klucz} onKlik={() => onWybierz(klucz)}>
        <span className="truncate font-bold">{g.nr}</span>
        <span className="text-sm text-slate-600">
          {g.dokId == null ? "Towar spoza dokumentu" : "Dokument spoza okna importu"}</span>
        <span className="mt-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">
          {otwarteWyjatki(g.ile)}</span>
      </Wiersz>;
    })}
  </ul>;
}

/**
 * Dostawy zdjęte z listy poza WERTIS — kto i dlaczego, bo to odróżnia decyzję od pomyłki.
 *
 * POWÓD SIĘ NIE UCINA: to jedyna odpowiedź na pytanie „dlaczego tej faktury
 * nikt nie rozkładał". Wiek stoi słowami, jak w pozostałych kubełkach.
 */
export function KolejkaPozaWertis({ lista, wybrany, onWybierz }: {
  lista: ZamknietaPoza[];
  wybrany: number | null;
  onWybierz: (dokId: number) => void;
}) {
  /* Bez „w tym oknie": ta lista nie ma okna, serwer oddaje każde zdjęcie. */
  if (!lista.length) return <Pusto waga="lista">Nic nie zdjęto z listy.</Pusto>;
  return <ul className="divide-y divide-slate-200">
    {lista.map((d) => <Wiersz key={d.dokId} aktywny={d.dokId === wybrany} onKlik={() => onWybierz(d.dokId)}>
      <span className="flex w-full items-baseline gap-2">
        <span className="truncate font-bold">{d.nrPelny}</span>
        <span className="ml-auto shrink-0 text-xs text-slate-600" title={`wystawiona ${dzien(d.dataWyst)}`}>
          {wiekDokumentu(d.dataWyst)}</span>
      </span>
      <span className="w-full truncate text-sm text-slate-600">{d.dostawca}</span>
      <span className="w-full text-xs text-slate-600">
        {d.zamknietaBy} · {czas(d.zamknietaAt)} · <span className="text-slate-700">{d.powod}</span></span>
    </Wiersz>)}
  </ul>;
}
