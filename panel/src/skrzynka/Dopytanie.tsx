import React from "react";
import { BookPlus, ExternalLink, MessageCircleQuestion } from "lucide-react";
import { Przycisk, ile } from "../ui";
import { ProcesCopilota } from "./ProcesCopilota";
import { Zwijka } from "./Zwijka";
import type { PasowanieZDopytania, UzycieNarzedziaCopilota, WymianaCopilota } from "../api/typy";

/* Nazwy narzędzi po ludzku. Serwer mówi `pasowanie_towaru`, agent czyta
   „pasowanie”; nieznana nazwa (nowsze narzędzie, starszy panel) zostaje
   jak przyszła, bo lepsza surowa nazwa niż zniknięte sprawdzenie. */
const NAZWY: Record<string, string> = {
  szukaj_towaru: "szukanie w kartotece",
  karta_towaru: "karta towaru",
  pasowanie_towaru: "pasowanie",
  czesci_do_maszyny: "części do maszyny",
  tresc_oferty: "treść oferty",
};

/**
 * CO COPILOT SPRAWDZIŁ W BAZIE (0.507.0). Jedna linijka pod odpowiedzią.
 * Odpowiedź „nie pasuje” po sprawdzeniu pasowania waży co innego niż ta sama
 * odpowiedź z pamięci modelu — i agent ma to widzieć, zanim uwierzy.
 * Brak linijki znaczy „nie sięgał”, więc pusta lista nie rysuje nic.
 */
function Sprawdzono({ narzedzia }: { narzedzia: UzycieNarzedziaCopilota[] }) {
  if (!narzedzia.length) return null;
  return <p className="mt-1 text-xs text-slate-600">
    Sprawdził w bazie: {narzedzia.map((n) => `${NAZWY[n.nazwa] ?? n.nazwa} „${n.argument}”`).join(", ")}
  </p>;
}

/**
 * ZNALEZIONE W SIECI (@wydanie). Pasowania ze stron, które model przeczytał
 * przy tym pytaniu i które przeszły sito serwera: cytat na stronie, NASZ
 * numer na stronie. Wcześniej biuro robiło to w czacie SZPERACZA obok panelu,
 * a wynik zostawał w czacie. Tu jedno kliknięcie kładzie parę w Kolejce Wiedzy.
 *
 * To NIE jest „wstaw”: nic stąd nie idzie do klienta. Propozycja czeka na
 * zatwierdzenie w Wiedzy jak każda inna — granica z nagłówka niżej stoi.
 */
function ZnalezioneWSieci({ pasowania, onZapisz, zapisuje }: {
  pasowania: PasowanieZDopytania[];
  onZapisz?: (nr: number) => void;
  zapisuje?: boolean;
}) {
  if (!pasowania.length) return null;
  return <div className="mt-2 rounded border border-slate-200 p-2" aria-label="Znalezione w sieci">
    <p className="text-xs font-semibold text-slate-700">Znalezione w sieci — strona potwierdza nasz numer</p>
    <ul className="mt-1 space-y-1.5">
      {pasowania.map((x, nr) => <li key={nr} className="text-sm">
        <p><span className="font-mono">{x.symbol}</span> → <b>{x.marka} {x.model}</b>
          <a className="ml-2 text-xs underline" href={x.url} target="_blank" rel="noreferrer">
            źródło<ExternalLink size={12} className="ml-0.5 inline" aria-hidden="true" /></a></p>
        <p className="text-xs text-slate-600">„{x.cytat}”</p>
        {x.warunek && <p className="text-xs text-amber-900"><b>Uwaga:</b> {x.warunek}</p>}
        {x.zapis === "nowa" && <p className="text-xs text-emerald-800">W Kolejce Wiedzy — czeka na zatwierdzenie.</p>}
        {x.zapis === "juz_byla" && <p className="text-xs text-slate-600">Ta para już jest w Wiedzy.</p>}
        {!x.zapis && onZapisz && <Przycisk className="mt-1 text-xs" disabled={zapisuje} onClick={() => onZapisz(nr)}>
          <BookPlus size={14} />Zapisz jako propozycję</Przycisk>}
      </li>)}
    </ul>
  </div>;
}

/**
 * DOPYTANIE COPILOTA (0.332.0) — rozmowa agenta z modelem o szkicu.
 *
 * Właściciel: „dodaj możliwość kontynuowania rozmowy z modelem, możliwość
 * dopytania, rozwiania wątpliwości".
 *
 * ODPOWIEDŹ JEST DLA AGENTA i ekran ma to mówić każdym elementem, bo to
 * jedyna rzecz, którą można tu pomylić kosztownie. Stąd trzy decyzje:
 *
 * Po pierwsze, odpowiedź NIE MA PRZYCISKU „wstaw". Szkic ma trzy („Wstaw",
 * „Zastąp", „Odrzuć"), bo szkic idzie do klienta. Tutaj przycisk wstawiania
 * byłby obejściem wszystkich sit szkicu jednym kliknięciem — a te sita są
 * jedynym powodem, dla którego tekst do klienta da się ufać. Kto chce mieć
 * z wymiany wiadomość, układa szkic od nowa; wymiana jest wtedy materiałem.
 *
 * Po drugie, kształt jest ROZMOWĄ, nie kartą. Pytanie agenta i odpowiedź
 * stoją naprzemiennie, bo druga wątpliwość zwykle wynika z pierwszej
 * odpowiedzi i agent musi widzieć, co już ustalił.
 *
 * Po trzecie, każda odpowiedź niesie swoje okno „Skąd to wiem" — ten sam
 * komponent, co przy szkicu. Odpowiedź „fakty tego nie rozstrzygają" jest
 * najcenniejsza dokładnie wtedy, gdy widać, czego zabrakło.
 *
 * Bez bursztynu: to nie jest ostrzeżenie ani zaznaczenie.
 *
 * ZWINIĘTE, DOPÓKI NIE MA O CO PYTAĆ (0.342.0). Pole tekstowe i przycisk
 * zajmowały wysokość w KAŻDEJ rozmowie, także tej, w której agent niczego nie
 * kwestionuje — a wątpliwość rodzi się dopiero po przeczytaniu szkicu, więc
 * płacił za nią wysokością, zanim ją miał. Blok z odbytą wymianą otwiera się
 * sam: tam jest już treść do przeczytania, nie sama możliwość.
 */
export function Dopytanie(p: {
  wymiany: WymianaCopilota[];
  wylaczony: boolean;
  /** `null` gdy nic nie leci; łańcuch = zdanie o tym, co poszło nie tak. */
  blad: string | null;
  pracuje: boolean;
  onPytaj: (pytanie: string) => void;
  limitZnakow: number;
  onZapiszPasowanie?: (wymianaId: number, nr: number) => void;
  zapisuje?: boolean;
}) {
  const [tekst, setTekst] = React.useState("");
  const zaDlugie = tekst.length > p.limitZnakow;
  const gotowe = tekst.trim().length > 0 && !zaDlugie && !p.pracuje && !p.wylaczony;

  /* PODPIS KRÓTSZY (0.517.0). „Odpowiedź czytasz Ty, nie klient" stało
     w podpisie przy każdym szkicu, pięć słów na myśl, którą niesie brak
     przycisku „wstaw". Zostają trzy słowa, bo sam sens — kto czyta — ma zostać. */
  return <Zwijka
    tytul="Dopytaj Copilota"
    Ikona={MessageCircleQuestion}
    podpis={p.wymiany.length > 0
      ? `${ile(p.wymiany.length, "wymiana", "wymiany", "wymian")} · tylko dla Ciebie`
      : "tylko dla Ciebie"}
    domyslnieOtwarte={p.wymiany.length > 0}
  >
    {p.wymiany.length > 0 && <ul className="divide-y divide-slate-100" aria-label="Wymiany z Copilotem">
      {p.wymiany.map((w) => <li key={w.id} className="p-2">
        <p className="text-xs font-semibold text-slate-700">{w.przez}: {w.pytanie}</p>
        <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">{w.odpowiedz}</pre>
        <Sprawdzono narzedzia={w.narzedzia ?? []} />
        <ZnalezioneWSieci pasowania={w.pasowania ?? []} zapisuje={p.zapisuje}
          onZapisz={p.onZapiszPasowanie && ((nr) => p.onZapiszPasowanie!(w.id, nr))} />
        <ProcesCopilota key={`${w.id}-${w.at}`} twierdzenia={w.twierdzenia} />
      </li>)}
    </ul>}

    <div className="p-2">
      <label className="sr-only" htmlFor="dopytanie-tresc">Pytanie do Copilota</label>
      <textarea
        id="dopytanie-tresc"
        className="w-full resize-y rounded border border-slate-300 p-2 text-sm text-slate-800"
        rows={2}
        placeholder="np. czy ten nóż na pewno pasuje do 46 cm i skąd to wiesz?"
        value={tekst}
        disabled={p.wylaczony}
        onChange={(e) => setTekst(e.target.value)}
      />
      <div className="mt-1 flex items-center gap-2">
        {/* Licznik pokazuje się dopiero BLISKO limitu. Stale widoczny uczy
            pisać krótko zamiast pisać jasno, a limit jest tu hamulcem na
            wklejony szkic, nie zachętą do skrótów. */}
        {tekst.length > p.limitZnakow - 150 && <span
          className={zaDlugie ? "text-xs font-semibold text-red-700" : "text-xs text-slate-600"}>
          {tekst.length} / {p.limitZnakow}
        </span>}
        {p.blad && <span className="text-xs text-red-700">{p.blad}</span>}
        <Przycisk
          className="ml-auto text-xs"
          wariant="glowny"
          disabled={!gotowe}
          onClick={() => { p.onPytaj(tekst.trim()); setTekst(""); }}
        >
          {p.pracuje ? "Pytam…" : "Zapytaj"}
        </Przycisk>
      </div>
    </div>
  </Zwijka>;
}
