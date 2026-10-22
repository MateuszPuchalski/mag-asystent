import React from "react";
import { MessageCircleQuestion, Paperclip, X } from "lucide-react";
import { Przycisk, czas, godzina, ile } from "../ui";
import { ProcesCopilota } from "./ProcesCopilota";
import { RoznicaSzkicu, TekstRoznicy, podsumowanieZmian } from "./RoznicaSzkicu";
import { Zwijka } from "./Zwijka";
import { obrazZeSchowka } from "./ZalacznikiWysylki";
import { lukaReczna, wersjaWPolu, wersjeSzkicu, type WersjaSzkicu } from "./wersjeSzkicu";
import { ZDJECIA_PYTANIA } from "../api/copilot";
import type { SzkicCopilota, UzycieNarzedziaCopilota, WymianaCopilota, ZdjecieWymiany } from "../api/typy";

/* Nazwy narzędzi po ludzku. Serwer mówi `karta_towaru`, agent czyta
   „karta towaru”; nieznana nazwa (nowsze narzędzie, starszy panel) zostaje
   jak przyszła, bo lepsza surowa nazwa niż zniknięte sprawdzenie.
   `pasowanie_towaru` i `czesci_do_maszyny` stoją w wymianach zapisanych
   w bazie, choć serwer już ich nie daje modelowi. */
const NAZWY: Record<string, string> = {
  szukaj_towaru: "szukanie w kartotece",
  karta_towaru: "karta towaru",
  pasowanie_towaru: "pasowanie",
  czesci_do_maszyny: "części do maszyny",
  tresc_oferty: "treść oferty",
};

/**
 * CO COPILOT SPRAWDZIŁ W BAZIE (0.507.0). Jedna linijka pod odpowiedzią.
 * Odpowiedź „nie mamy” po sprawdzeniu kartoteki waży co innego niż ta sama
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
 * Zdjęcia, które agent dołączył do pytania, pod jego treścią.
 *
 * Numer stoi przy każdym, bo model mówi o zdjęciu po numerze („na Z9 widać”),
 * a agent ma wiedzieć, o którym. Bez miniatury zostaje sam numer z nazwą:
 * zdjęcie poszło do modelu, tylko przeglądarka nie zrobiła podglądu.
 */
function ZdjeciaWymiany({ zdjecia }: { zdjecia: ZdjecieWymiany[] }) {
  if (!zdjecia.length) return null;
  return <ul className="mt-1 flex flex-wrap items-end gap-2" aria-label="Zdjęcia dołączone do pytania">
    {zdjecia.map((z) => <li key={z.numer}>
      {z.miniatura
        ? <img src={`data:image/jpeg;base64,${z.miniatura}`} title={`${z.numer} · ${z.nazwa}`}
            alt={`Zdjęcie ${z.numer} dołączone do pytania: ${z.nazwa}`}
            className="h-16 max-w-28 rounded border border-slate-200 object-cover" />
        : <span className="text-xs text-slate-700">{z.numer} · {z.nazwa}</span>}
    </li>)}
  </ul>;
}

/** Granica jednego zdjęcia w megabajtach, do zdań dla agenta. */
const MB = ZDJECIA_PYTANIA.bajtow / 1_000_000;

/**
 * Rozmiar w megabajtach dziesiętnych, zaokrąglony W GÓRĘ do dziesiątej.
 * Zaokrąglony zwykle plik o bajt za duży czytałby się „7,0 MB, granica 7 MB”.
 */
const megabajty = (bajtow: number) =>
  `${(Math.ceil(bajtow / 100_000) / 10).toFixed(1).replace(".", ",")} MB`;

/** Plik czekający na wysłanie razem z adresem podglądu. */
type ZdjecieWToku = { id: number; plik: File; podglad: string };

/**
 * Zdanie, czemu plik nie wszedł, albo `null`, gdy wchodzi.
 *
 * Odmowa pada PRZY DOŁĄCZANIU, a nie przy wysyłce: wtedy agent ma jeszcze
 * pod ręką inny plik, a polecenie nie odpada razem ze złym zdjęciem.
 */
function odmowaZdjecia(plik: File, juzJest: number, juzBajtow: number): string | null {
  if (!ZDJECIA_PYTANIA.typy.includes(plik.type)) {
    return `Plik „${plik.name}” nie wszedł: Copilot czyta zdjęcia JPEG, PNG, WEBP i GIF.`;
  }
  if (plik.size > ZDJECIA_PYTANIA.bajtow) {
    return `Zdjęcie „${plik.name}” nie weszło: ma ${megabajty(plik.size)}, a granica to ${MB} MB.`;
  }
  if (juzJest >= ZDJECIA_PYTANIA.najwiecej) {
    return `Zdjęcie „${plik.name}” nie weszło: do jednego pytania dołączysz najwyżej ${
      ZDJECIA_PYTANIA.najwiecej} zdjęcia.`;
  }
  if (juzBajtow + plik.size > ZDJECIA_PYTANIA.lacznie) {
    return `Zdjęcie „${plik.name}” nie weszło: razem byłoby ${megabajty(juzBajtow + plik.size)}, `
      + `a granica na pytanie to ${ZDJECIA_PYTANIA.lacznie / 1_000_000} MB.`;
  }
  return null;
}

/**
 * Nowa wersja szkicu z jednej wymiany: numer, godzina, ile słów i droga do pola.
 *
 * JEDNA LINIA, NIE DRUGI SZKIC. Zgłoszenie właściciela: „poprawki powinny być
 * w inteligentny sposób nałożone na szkic, żeby nie tworzyć kolejnego
 * bloku”. Wersja wchodzi do pola sama, a pole pokazuje poprawkę na miejscu
 * (`PoprawkaWPolu.tsx`). Pełna różnica tutaj powtarzała cały tekst drugi raz
 * pod polem. Stoi więc zwinięta za „Pokaż zmiany”, także przy najnowszej:
 * sięga się po nią przy starszych wersjach i przy pytaniu, co model ruszył.
 *
 * Przycisk nie stoi przy wersji, która JUŻ jest w polu. Wstawienie jej drugi
 * raz niczego nie zmienia, a przycisk sugerowałby, że zmienia.
 */
function Wersja({ w, po, wersja, najnowsza, wPolu, wylaczony, onWstaw }: {
  w: WymianaCopilota;
  po: string;
  /** `null` = poprawka wcześniejszego szkicu, spoza historii obecnego. */
  wersja: WersjaSzkicu | null;
  najnowsza: boolean;
  wPolu: boolean;
  wylaczony: boolean;
  onWstaw: (tresc: string) => void;
}) {
  const [zmiany, setZmiany] = React.useState(false);
  const przed = w.szkicPrzed ?? "";
  const podsumowanie = React.useMemo(() => podsumowanieZmian(przed, po), [przed, po]);
  const nazwa = wersja ? `Wersja ${wersja.nr}` : "Wersja wcześniejszego szkicu";
  const napis = najnowsza ? "Wstaw do odpowiedzi" : "Przywróć tę wersję";
  const idZmian = `zmiany-wersji-${w.id}`;
  return <div role="group" aria-label={nazwa} className="mt-2 rounded border border-violet-200 p-2">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-xs font-semibold text-violet-900" title={czas(w.at)}>{nazwa} · {godzina(w.at)}</p>
      <span className="text-xs text-slate-700">· {podsumowanie}</span>
      <button type="button" aria-expanded={zmiany} aria-controls={idZmian}
        className="min-h-6 rounded px-1 text-xs font-semibold text-violet-900 hover:bg-violet-50 hover:underline"
        onClick={() => setZmiany((z) => !z)}>{zmiany ? "Ukryj zmiany" : "Pokaż zmiany"}</button>
      {/* Poprawka starego szkicu nie ma przycisku. Odpowiada na fakty sprzed
          „Ułóż ponownie”, a tarcie przy wysyłce liczy tylko wersje obecnego. */}
      {/* Numer wersji w nazwie dla czytnika: „Wstaw do odpowiedzi” stoi też
          przy oryginale w karcie szkicu, a „Przywróć” przy każdej starszej. */}
      {wersja && (wPolu
        ? <span className="ml-auto text-xs font-semibold text-violet-900">w polu</span>
        : <Przycisk className="ml-auto text-xs" wariant={najnowsza ? "glowny" : "drugi"}
            aria-label={`${napis} — wersja ${wersja.nr}`}
            disabled={wylaczony} onClick={() => onWstaw(po)}>{napis}</Przycisk>)}
    </div>
    {zmiany && <div id={idZmian}><TekstRoznicy przed={przed} po={po} /></div>}
    <ProcesCopilota key={`${w.id}-${w.at}-wersja`} twierdzenia={w.szkicTwierdzenia ?? []} />
  </div>;
}

/**
 * DOPYTANIE COPILOTA — polecenie albo pytanie agenta o szkic w polu.
 *
 * Właściciel: „dodaj możliwość kontynuowania rozmowy z modelem, możliwość
 * dopytania, rozwiania wątpliwości”. I drugie: Copilot ma POPRAWIAĆ szkic,
 * a nie mówić, co poprawić, i trzymać historię wersji, bo przepisywanie
 * cudzej rady do pola to praca, którą model zrobi sam.
 *
 * Model sam rozpoznaje, co dostał. Polecenie daje nową wersję szkicu
 * i notkę, co zmienił. Pytanie daje samą odpowiedź.
 *
 * NOTKA NIE MA PRZYCISKU „WSTAW”. Czyta ją agent, a przycisk byłby obejściem
 * wszystkich sit szkicu jednym kliknięciem. Przycisk ma tylko WERSJA, bo
 * serwer przepuścił ją przez te same sita co szkic. Nowa wersja wchodzi do
 * pola sama, z poprawką podświetloną w polu i paskiem „Cofnij”
 * (`ekrany/Skrzynka.tsx`).
 *
 * KSZTAŁT JEST ROZMOWĄ, NIE KARTĄ. Polecenie i to, co z nim zrobił model,
 * stoją naprzemiennie, bo druga prośba zwykle wynika z pierwszej odpowiedzi.
 * Każda odpowiedź i każda wersja niesie swoje okno „Skąd to wiem”.
 *
 * Bez bursztynu: to nie jest ostrzeżenie ani zaznaczenie.
 *
 * ZWINIĘTE, DOPÓKI NIE MA O CO PYTAĆ. Pole i przycisk zajmowały wysokość
 * w każdej rozmowie, a wątpliwość rodzi się dopiero po przeczytaniu szkicu.
 * Blok z odbytą wymianą otwiera się sam, bo jest w nim treść do przeczytania.
 */
export function Dopytanie(p: {
  wymiany: WymianaCopilota[];
  /** Szkic Copilota, od którego liczy się historia wersji; `null` = brak szkicu. */
  szkic: SzkicCopilota | null;
  /** Tekst pola odpowiedzi. Po nim blok poznaje wersję, która stoi „w polu”. */
  pole: string;
  /** Wersja do pola odpowiedzi — ekran stawia przy tym pasek „Cofnij”. */
  onWstaw: (tresc: string) => void;
  wylaczony: boolean;
  /** `null` gdy nic nie leci; łańcuch = zdanie o tym, co poszło nie tak. */
  blad: string | null;
  pracuje: boolean;
  /** Pliki idą surowe; base64 i miniaturę robi ekran, bo ten katalog jest czysty. */
  onPytaj: (pytanie: string, pliki: File[]) => void;
  limitZnakow: number;
}) {
  const [tekst, setTekst] = React.useState("");
  const zaDlugie = tekst.length > p.limitZnakow;
  /* Samo zdjęcie nie wystarcza: serwer wymaga pytania, a model bez polecenia
     nie wie, czy ma przepisać wymiary do szkicu, czy tylko je sprawdzić. */
  const gotowe = tekst.trim().length > 0 && !zaDlugie && !p.pracuje && !p.wylaczony;

  /* ── ZDJĘCIA DO PYTANIA ─────────────────────────────────────────────────
     Kartka z wymiarami z innego kanału albo zdjęcie części z magazynu.
     Podgląd idzie przez adres `blob:`, który trzyma plik w pamięci karty,
     dopóki ktoś go nie zwolni. Zwalniamy przy usunięciu, przy wysłaniu
     i przy zniknięciu bloku, bo karta skrzynki żyje przez całą zmianę. */
  const [zdjecia, setZdjecia] = React.useState<ZdjecieWToku[]>([]);
  const [odmowa, setOdmowa] = React.useState<string | null>(null);
  const kolejny = React.useRef(0);
  const zdjeciaTeraz = React.useRef(zdjecia);
  zdjeciaTeraz.current = zdjecia;
  React.useEffect(() => () => {
    for (const z of zdjeciaTeraz.current) URL.revokeObjectURL(z.podglad);
  }, []);
  const wejscie = React.useRef<HTMLInputElement>(null);
  const pelne = zdjecia.length >= ZDJECIA_PYTANIA.najwiecej;
  const zablokowane = p.wylaczony || p.pracuje;

  const dolacz = (pliki: File[]) => {
    const nowe: ZdjecieWToku[] = [];
    const odmowy: string[] = [];
    for (const plik of pliki) {
      const powod = odmowaZdjecia(plik, zdjecia.length + nowe.length,
        [...zdjecia, ...nowe].reduce((s, z) => s + z.plik.size, 0));
      if (powod) { odmowy.push(powod); continue; }
      nowe.push({ id: ++kolejny.current, plik, podglad: URL.createObjectURL(plik) });
    }
    setOdmowa(odmowy.length ? odmowy.join(" ") : null);
    if (nowe.length) setZdjecia([...zdjecia, ...nowe]);
  };
  const usun = (id: number) => {
    const z = zdjecia.find((x) => x.id === id);
    if (z) URL.revokeObjectURL(z.podglad);
    setZdjecia(zdjecia.filter((x) => x.id !== id));
    setOdmowa(null);
  };

  const wersje = wersjeSzkicu(p.szkic, p.wymiany);
  const wPolu = wersjaWPolu(wersje, p.pole);
  const poprawki = wersje.filter((v) => v.zrodlo === "wymiana");
  const ostatnia = poprawki[poprawki.length - 1];
  const wersjaWymiany = (id: number) =>
    poprawki.find((v) => v.zrodlo === "wymiana" && v.wymianaId === id) ?? null;

  /* PODPIS MÓWI, CO JEST W ŚRODKU, gdy blok jest zamknięty: ile wymian
     i ile z nich poprawiło szkic. Bez wymian mówi, co da się tu zrobić. */
  const podpis = p.wymiany.length > 0
    ? [ile(p.wymiany.length, "wymiana", "wymiany", "wymian"),
      poprawki.length > 0 ? ile(poprawki.length, "poprawka", "poprawki", "poprawek") : ""]
      .filter(Boolean).join(" · ")
    : "poprawi szkic albo odpowie";

  return <Zwijka
    tytul="Dopytaj Copilota"
    Ikona={MessageCircleQuestion}
    podpis={podpis}
    domyslnieOtwarte={p.wymiany.length > 0}
  >
    {p.wymiany.length > 0 && <ul className="divide-y divide-slate-100" aria-label="Wymiany z Copilotem">
      {p.wymiany.map((w) => {
        const po = typeof w.szkicPo === "string" && w.szkicPo !== "" ? w.szkicPo : null;
        const wersja = wersjaWymiany(w.id);
        const luka = lukaReczna(wersje, w);
        return <li key={w.id} className="p-2">
          <p className="text-xs font-semibold text-slate-700">{w.przez}: {w.pytanie}</p>
          <ZdjeciaWymiany zdjecia={w.zdjecia ?? []} />
          {/* Ręczne zmiany agenta przed poleceniem. Różnica wersji niżej
              pokazuje tylko zmiany modelu, więc te stałyby się niewidoczne. */}
          {luka && <details className="mt-1">
            <summary className="cursor-pointer text-xs text-slate-700">Twoje zmiany przed poprawką</summary>
            <RoznicaSzkicu przed={luka.poprzednia.tresc} po={luka.przed} />
          </details>}
          <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">{w.odpowiedz}</pre>
          <Sprawdzono narzedzia={w.narzedzia ?? []} />
          <ProcesCopilota key={`${w.id}-${w.at}`} twierdzenia={w.twierdzenia ?? []} />
          {po !== null && <Wersja w={w} po={po} wersja={wersja}
            najnowsza={wersja !== null && wersja === ostatnia}
            wPolu={wersja !== null && wersja === wPolu}
            wylaczony={p.wylaczony} onWstaw={p.onWstaw} />}
          {/* Zdanie przychodzi z serwera całe, z podmiotem i skutkiem („…więc
              szkic został bez zmian”), bo tylko serwis wie, które sito je dało. */}
          {w.szkicOdrzucony && <p className="mt-1 text-xs text-red-700">{w.szkicOdrzucony}</p>}
        </li>;
      })}
    </ul>}

    <div className="p-2">
      <label className="sr-only" htmlFor="dopytanie-tresc">Polecenie albo pytanie do Copilota</label>
      <textarea
        id="dopytanie-tresc"
        className="w-full resize-y rounded border border-slate-300 p-2 text-sm text-slate-800"
        rows={2}
        placeholder="np. dodaj link do drugiej wersji gaźnika albo zapytaj: skąd wiesz, że pasuje?"
        value={tekst}
        disabled={p.wylaczony}
        onChange={(e) => setTekst(e.target.value)}
        /* Zrzut ekranu wkleja się szybciej, niż zapisuje do pliku. Tekst
           wygrywa z obrazem tak samo jak w polu odpowiedzi (`obrazZeSchowka`). */
        onPaste={(e) => {
          const plik = obrazZeSchowka(e.clipboardData);
          if (!plik) return;
          e.preventDefault();
          /* W trakcie „Pytam…” obraz nie wchodzi, ale agent ma o tym wiedzieć:
             cicho przechwycone wklejenie wygląda jak zepsuty schowek. */
          if (zablokowane) setOdmowa("Zdjęcie nie weszło: poczekaj na odpowiedź Copilota i wklej je ponownie.");
          else dolacz([plik]);
        }}
      />
      {zdjecia.length > 0 && <ul className="mt-1 flex flex-wrap gap-2" aria-label="Zdjęcia do pytania">
        {zdjecia.map((z) => <li key={z.id}
          className="flex items-center gap-1.5 rounded border border-slate-200 p-1 text-xs text-slate-700">
          <img src={z.podglad} alt={z.plik.name} className="h-10 w-10 rounded object-cover" />
          <span className="max-w-40 truncate">{z.plik.name}</span>
          <button type="button" disabled={zablokowane} onClick={() => usun(z.id)}
            aria-label={`Usuń zdjęcie ${z.plik.name}`} title="Usuń"
            className="grid min-h-6 min-w-6 place-items-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40">
            <X size={13} />
          </button>
        </li>)}
      </ul>}
      <div className="mt-1 flex items-center gap-2">
        {/* `multiple`, bo kartka bywa w dwóch zdjęciach, a drugi raz przez
            okno wyboru to drugie szukanie tego samego katalogu. */}
        <input ref={wejscie} type="file" accept={ZDJECIA_PYTANIA.typy.join(",")} multiple
          className="hidden" aria-label="Wybierz zdjęcia do pytania"
          onChange={(e) => {
            const pliki = Array.from(e.target.files ?? []);
            /* Bez czyszczenia ten sam plik wybrany drugi raz nie wywoła `change`. */
            e.target.value = "";
            dolacz(pliki);
          }} />
        {/* Pełna lista gasi spinacz zamiast przyjąć czwarte zdjęcie i odmówić:
            błąd, któremu da się zapobiec, nie potrzebuje zdania (dekalog p. 6). */}
        <button type="button" disabled={zablokowane || pelne}
          aria-label="Dołącz zdjęcie do pytania"
          title={pelne
            ? `Najwyżej ${ZDJECIA_PYTANIA.najwiecej} zdjęcia na pytanie`
            : `Dołącz zdjęcie albo wklej je w pole — JPEG, PNG, WEBP lub GIF, najwyżej ${MB} MB`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded border border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800 disabled:opacity-40"
          onClick={() => wejscie.current?.click()}>
          <Paperclip size={14} />
        </button>
        {odmowa && <span role="alert" className="text-xs text-red-700">{odmowa}</span>}
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
          /* Zdjęcia schodzą z listy razem z tekstem, tak jak dotąd pole.
             Zostawione wisiałyby pod następnym pytaniem i poszłyby z nim drugi raz. */
          onClick={() => {
            p.onPytaj(tekst.trim(), zdjecia.map((z) => z.plik));
            for (const z of zdjecia) URL.revokeObjectURL(z.podglad);
            setTekst(""); setZdjecia([]); setOdmowa(null);
          }}
        >
          {p.pracuje ? "Pytam…" : "Zapytaj"}
        </Przycisk>
      </div>
    </div>
  </Zwijka>;
}
