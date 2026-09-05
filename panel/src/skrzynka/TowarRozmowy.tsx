import React, { useState } from "react";
import { Check, PackageSearch, X as Krzyzyk } from "lucide-react";
import type { KartaTowaru, OfertaRozmowy } from "../api/typy";
import { useKartaTowaru, useWskazKartoteke } from "../api/rozmowy";
import { useWiedzaTowaru } from "../api/wiedza";
import { Wyszukiwarka, type Towar as TowarZWyszukiwarki } from "../wyszukiwarka";
import { Kafel } from "../towar/Kafel";

/**
 * Towar z Subiekta przy rozmowie (0.179.0).
 *
 * SKU sprzedawcy leżało w `offer_snapshot` od 0.178.0 i nie prowadziło
 * donikąd: żeby sprawdzić stan i półkę, agent otwierał Subiekta — czyli robił
 * to, czego §25 zabrania („agent obsłuży typowe pytanie bez otwierania panelu
 * Allegro" ma ten sam sens co „bez otwierania Subiekta").
 *
 * Blok ma trzy stany i każdy każe co innego zrobić: potwierdzona kartoteka
 * (widać stan i półkę), propozycja z automatu (jedno kliknięcie), brak
 * z POWODEM (wiadomo, które ogniwo pękło i czy naprawi się samo).
 *
 * ŹRÓDŁA SIĘ NIE MIESZAJĄ (§4.3). Wszystko pod nagłówkiem „Subiekt GT" jest
 * z Subiekta, a podpis przy kartotece mówi, czy stoi za nią SKU z Allegro,
 * czy decyzja człowieka.
 */
export function TowarRozmowy({ oferta, rozmowaId, onWstawDoSzkicu }: {
  oferta: OfertaRozmowy;
  rozmowaId: number;
  /** Wstawka do szkicu. Opcjonalna: blok bywa też oglądany bez edytora obok. */
  onWstawDoSzkicu?: (tresc: string) => void;
}) {
  const [szukam, setSzukam] = useState(false);
  const zapisz = useWskazKartoteke();
  const k = oferta.kartoteka;
  /* Potwierdzona jest wtedy, gdy stoi za nią człowiek — pamięć wskazań.
     Propozycja automatu ma `twId`, ale czeka na kliknięcie. */
  const potwierdzona = k.pewnosc === "pamiec" ? k.twId : null;
  const karta = useKartaTowaru(potwierdzona);
  /* Wiedza pyta o KAŻDĄ znaną kartotekę, także propozycję: „3 potwierdzone,
     1 negatywne" to argument za kliknięciem albo przeciw niemu. */
  const wiedza = useWiedzaTowaru(k.twId);

  const ustaw = (twId: number | null) => zapisz.mutate(
    { id: rozmowaId, ofertaId: oferta.externalId, twId },
    { onSuccess: () => setSzukam(false) });

  return <div className="space-y-3 p-4">
    <div className="flex items-center gap-2">
      <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
        Źródło: Subiekt GT
      </span>
      {/* OSOBNA plakietka, poza blokiem Subiekta: §4.3 nie miesza źródeł, a to
          jest nasza baza wiedzy, nie dane z ERP. */}
      {wiedza.data && (wiedza.data.potwierdzone.length > 0 || wiedza.data.negatywne.length > 0) &&
        <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
          Wiedza: {wiedza.data.potwierdzone.length} potwierdzonych · {wiedza.data.negatywne.length} negatywnych
        </span>}
    </div>

    {potwierdzona !== null
      ? <>
          <div className="flex items-start gap-3">
            <Kafel twId={potwierdzona} rozmiar={72} nazwa={karta.data?.name ?? k.symbol ?? ""}
              symbol={k.symbol} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{karta.data?.name ?? k.symbol}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-600">{k.symbol}</p>
              <p className="mt-1 text-xs text-slate-500">
                {/* Puste `sku` w pamięci znaczy „wskazał człowiek". Serwer pisze
                    to zdanie; panel go nie układa drugi raz. */}
                {k.zrodlo}
              </p>
            </div>
            <button type="button" title="Zdejmij powiązanie" disabled={zapisz.isPending}
              onClick={() => ustaw(null)}
              className="ml-auto h-6 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
              <Krzyzyk size={14} />
            </button>
          </div>

          {karta.isLoading && <p className="text-xs text-slate-500">Wczytuję stan z Subiekta…</p>}
          {karta.error && <p className="text-xs text-red-700">{(karta.error as Error).message}</p>}
          {karta.data && <>
            <StanTowaru karta={karta.data} />
            <OpisKartoteki desc={karta.data.desc} />
            {/* Przycisk stoi POD tabelą, nie nad nią: agent najpierw sprawdza,
                czy to ta kartoteka, a dopiero potem przepisuje ją do odpowiedzi.
                Nad tabelą zapraszałby do wstawienia czegoś nieprzeczytanego. */}
            {onWstawDoSzkicu && <button type="button"
              onClick={() => onWstawDoSzkicu(parametryDoSzkicu(karta.data!))}
              className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
              Wstaw parametry do szkicu</button>}
          </>}
        </>
      : <div className="text-xs">
          {k.twId !== null
            /* Propozycja nie udaje faktu — mówi, skąd się wzięła, i czeka na
               zatwierdzenie (§4.3, §11.3).

               Zdjęcie przy PROPOZYCJI (0.203.0). Do 0.202.0 kafel dostawała
               wyłącznie kartoteka potwierdzona — czyli ta, przy której nikt
               już niczego nie rozstrzyga. Propozycja automatu jest dokładnie
               tym miejscem, gdzie człowiek decyduje, i decydował po samym
               symbolu: „FTC272" nie mówi, czy to podkładka, czy szarpak.
               Zdjęcie zamienia zatwierdzenie w spojrzenie. */
            ? <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-2">
                <Kafel twId={k.twId} rozmiar={56} nazwa={k.symbol ?? "Propozycja kartoteki"}
                  symbol={k.symbol} />
                <div className="min-w-0 flex-1 text-amber-900">
                  <p>Propozycja: <b className="font-mono text-sm">{k.symbol}</b></p>
                  <p className="mt-0.5 text-slate-500">{k.zrodlo}</p>
                  <button type="button" disabled={zapisz.isPending} onClick={() => ustaw(k.twId)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                    <Check size={12} />Zatwierdź</button>
                </div>
              </div>
            /* POWÓD, nie samo „bez kartoteki": „oferty jeszcze nie pobrano"
               naprawi się samo w kilka minut, a „oferta bez SKU" nigdy. */
            : <p className="flex items-start gap-2 text-slate-500">
                <PackageSearch size={14} className="mt-0.5 shrink-0" />
                <span>Bez kartoteki · <span className="text-slate-600">{k.zrodlo}</span></span>
              </p>}

          {szukam
            ? <div className="mt-2">
                <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
                  onWybierz={(t: TowarZWyszukiwarki | null) => t && ustaw(t.id)} />
              </div>
            : <button type="button" onClick={() => setSzukam(true)}
                className="mt-2 block text-slate-500 underline underline-offset-2 hover:text-slate-800">
                wskaż kartotekę</button>}
        </div>}

    {zapisz.error && <p className="text-xs text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
}

/**
 * Stan magazynowy. „Dostępny" stoi OSOBNO od stanu, bo to on odpowiada na
 * pytanie klienta — stan bez odjętych rezerwacji obiecuje towar, który jest
 * już czyjś.
 */
/**
 * Parametry towaru jako tekst do szkicu (§10.4, makieta `Main.dc.html`).
 *
 * SZKIC IDZIE DO KLIENTA i to jest cała trudność tej funkcji. Blok Subiekta
 * pokazuje na ekranie sześć wierszy, ale trzy z nich są WEWNĘTRZNE: półka,
 * rezerwacje i rozbicie na magazyny. Adres regału w odpowiedzi do kupującego
 * nie znaczy dla niego nic, a mówi obcemu, jak zbudowany jest nasz magazyn.
 * Wstawka bierze więc tożsamość towaru i dostępność — czyli to, po co klient
 * napisał — i ani jednego pola więcej.
 *
 * Zdanie układa PANEL, nie serwer, i to jest różnica względem doboru (§14.3):
 * tam zdanie niesie TWIERDZENIE o pasowaniu i musi cytować dowód, więc pisze
 * je serwer. Tu nie ma twierdzenia — są wartości pól kartoteki, przepisane
 * jeden do jednego z tego, co agent ma przed oczami.
 *
 * Brak stanu mówi „brak na stanie", nie „0 szt.". Zero w tabeli czyta agent,
 * a zdanie czyta klient — i „0 szt." brzmi jak awaria systemu, nie jak
 * odpowiedź. Terminu dostawy wstawka NIE obiecuje, bo go nie zna.
 */
export function parametryDoSzkicu(karta: KartaTowaru): string {
  const jednostka = karta.unit ?? "szt.";
  const linie = [`${karta.name} (symbol ${karta.sym})`];
  if (karta.ean) linie.push(`EAN: ${karta.ean}`);
  const numery = (karta.identyfikatory ?? []).map((i) => i.wartosc);
  if (numery.length > 0) linie.push(`Numery: ${numery.join(", ")}`);
  linie.push(karta.mag.avail > 0
    ? `Dostępność: ${karta.mag.avail} ${jednostka}`
    : "Dostępność: brak na stanie");
  return linie.join("\n");
}

/**
 * Opis kartoteki z Subiekta (0.198.0).
 *
 * Pole `desc` jechało w odpowiedzi `/api/products/:twId` od dawna i panel NIE
 * pokazywał go nigdzie. A to w nim ta firma trzyma wymiary, gwinty, rozstawy
 * i sekcje „Modele:" — czyli odpowiedzi na pytania, które klienci zadają
 * najczęściej. Właściciel przysłał zrzut, na którym klient prosi o wymiar
 * gwintu korka; opis kartoteki stał wtedy w pobranych danych, niewidoczny.
 *
 * ZWINIĘTY DO SZEŚCIU LINII, bo opisy bywają na pół ekranu, a kolumna niesie
 * też stan i półkę. Rozwinięcie jest jednym kliknięciem i nie idzie po sieć.
 *
 * BEZ PRZYCISKU „wstaw do szkicu" i to jest decyzja. Wstawka parametrów
 * (`parametryDoSzkicu`) wybiera pola świadomie, bo szkic idzie DO KLIENTA;
 * opis to wolny tekst, w którym bywa notatka dla magazynu. Agent może
 * skopiować zdanie, które przeczytał — ale nie wyśle całości jednym kliknięciem,
 * nie wiedząc, co w niej stoi.
 */
function OpisKartoteki({ desc }: { desc?: string }) {
  const [calosc, setCalosc] = useState(false);
  const tresc = (desc ?? "").trim();
  if (!tresc) return null;

  return <div className="rounded-lg border border-slate-200 p-3">
    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
      Opis kartoteki</p>
    <p className={`whitespace-pre-wrap text-xs text-slate-700 ${calosc ? "" : "line-clamp-6"}`}>
      {tresc}</p>
    {/* Przycisk tylko wtedy, gdy jest co rozwijać. Linii nie liczymy w kodzie
        — `line-clamp` robi to w przeglądarce. Sześć, a nie osiem, bo domyślna
        skala Tailwinda kończy się na sześciu, a `line-clamp-8` nie powstałoby
        w arkuszu i opis jechałby CAŁY. */}
    {tresc.length > 320 && <button type="button" onClick={() => setCalosc((c) => !c)}
      className="mt-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
      {calosc ? "zwiń opis" : "pokaż cały opis"}</button>}
  </div>;
}

function StanTowaru({ karta }: { karta: KartaTowaru }) {
  const wiersze: Array<[string, string]> = [
    ["Stan", `${karta.mag.stan} ${karta.unit ?? "szt."}`],
    ["Rezerwacje", `${karta.mag.rez} ${karta.unit ?? "szt."}`],
    ["Dostępny", `${karta.mag.avail} ${karta.unit ?? "szt."}`],
    ["Lokalizacja", karta.locs.length ? karta.locs.join(" · ") : "brak"],
    ["EAN", karta.ean || "brak"],
    /* Identyfikatory z opisu (E3): to, po czym klient pyta, gdy nie zna naszego symbolu. */
    ["Identyfikatory", karta.identyfikatory?.length ? karta.identyfikatory.map((i) => i.wartosc).join(" · ") : "brak"],
  ];
  return <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
    {wiersze.map(([nazwa, wartosc]) => <div key={nazwa} className="flex items-baseline gap-2 text-xs">
      <span className="w-24 shrink-0 text-slate-500">{nazwa}</span>
      <span className={`font-semibold ${nazwa === "Dostępny" && karta.mag.avail <= 0
        ? "text-ranga-zle" : "text-slate-900"}`}>{wartosc}</span>
    </div>)}
    {karta.magazyny.length > 0 && <p className="pt-1 text-[11px] text-slate-500">
      Inne magazyny: {karta.magazyny.map((m) => `${m.kod} ${m.stan}`).join(" · ")}
    </p>}
  </div>;
}
