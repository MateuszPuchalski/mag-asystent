import React, { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import type { DowodReklamacji, SzczegolReklamacji, ZalacznikReklamacji } from "../api/typy";
import { czas, dzienMiesiac, ile, NaglowekSekcji, Przycisk } from "../ui";
import { Kafel, KafelOferty } from "../towar/Kafel";
import { ListaZalacznikow } from "../towar/Zalacznik";
import { ZalacznikSprawy, etykietaRoli } from "./Czat";
import { twIdSprawy } from "./Glowica";

/* ── Kolumna dowodów i zdjęć — obok rozmowy ──────────────────────────────────
   Decyzja właściciela przy przebudowie ekranu: lista dowodów stoi NA GÓRZE
   kolumny zdjęć, tuż obok rozmowy. Agent pisze, co widać na zdjęciu, czego
   brakuje i co ustaliliśmy, a wpis odsyła do zdjęcia numerem `Z1`. Następna
   osoba przy tej sprawie nie musi wtedy oglądać wszystkiego od nowa.

   DOWODY SĄ SWOBODNE, nie są listą kroków. Sprawy różnią się na tyle, że
   lista kroków albo by kłamała, albo rosła bez końca. Wpis to zdanie biura,
   opcjonalnie zdjęcie, autor i chwila — i nic więcej nie udaje.

   POD DOWODAMI TO, NA CO SIĘ POWOŁUJĄ. Najpierw „Wysłaliśmy": zdjęcie oferty,
   czyli to, co klient widział przy zakupie, i kartoteki, czyli to, co leży
   u nas. Potem zdjęcia klienta pogrupowane tak jak w rozmowie. Porównanie
   „co obiecaliśmy" z „co przyszło" bywa całą sprawą.

   NUMERY ZDJĘĆ SĄ STAŁE. `Z1`, `Z2`… liczą się po rosnącym numerze
   załącznika, więc nowe zdjęcie dostaje kolejny numer, a stare nie zmieniają
   swoich. Wpis z „Z2" ma wskazywać to samo zdjęcie za tydzień.          */

/** Najdłuższy wpis — ten sam limit, którego pilnuje serwer. */
export const LIMIT_DOWODU = 2000;

/** Od ilu znaków przed sufitem licznik w ogóle się pokazuje. */
const PROG_LICZNIKA = 200;

interface ZdjecieZeZnakiem { z: ZalacznikReklamacji; znak: string; at: string | null }

/**
 * Zdjęcia sprawy z numerami `Z1`…`Zn` i ich grupy, w kolejności rozmowy.
 *
 * Grupy idą jak w rozmowie: zgłoszenie, potem wiadomości. Numer idzie po
 * identyfikatorze załącznika, nie po miejscu w grupie, bo identyfikator się
 * nie zmienia, a kolejność wiadomości po dociągnięciu rozmowy może.
 */
export function zdjeciaSprawy(s: Pick<SzczegolReklamacji, "reklamacja" | "czat" | "zalaczniki">) {
  const zrodla: Array<{ klucz: string; podpis: string; at: string | null; lista: ZalacznikReklamacji[] }> = [
    { klucz: "zgloszenie", podpis: `Zgłoszenie · ${czas(s.reklamacja.otwartoAt)}`,
      at: s.reklamacja.otwartoAt, lista: s.zalaczniki ?? [] },
    ...(s.czat ?? []).map((w) => ({
      klucz: `w-${w.id}`, podpis: `${etykietaRoli(w)} · ${czas(w.utworzonoAt)}`,
      at: w.utworzonoAt, lista: w.zalaczniki,
    })),
  ];
  const kiedy = new Map<number, string | null>();
  for (const g of zrodla) for (const z of g.lista) if (z.podglad && !kiedy.has(z.id)) kiedy.set(z.id, g.at);
  const znaki = new Map<number, string>();
  [...kiedy.keys()].sort((a, b) => a - b).forEach((id, i) => znaki.set(id, `Z${i + 1}`));
  const widziane = new Set<number>();
  const grupy = zrodla.map((g) => ({
    klucz: g.klucz, podpis: g.podpis,
    lista: g.lista.filter((z) => z.podglad && !widziane.has(z.id) && widziane.add(z.id))
      .map((z): ZdjecieZeZnakiem => ({ z, znak: znaki.get(z.id)!, at: g.at })),
  })).filter((g) => g.lista.length > 0);
  const poNumerze = grupy.flatMap((g) => g.lista).sort((a, b) => a.z.id - b.z.id);
  return { grupy, znaki, poNumerze };
}

/** Pierwsze słowa wpisu — do nazwy przycisku, żeby czytnik wiedział, co usuwa. */
const skrot = (t: string) => (t.length > 40 ? `${t.slice(0, 40).trimEnd()}…` : t);

export function KolumnaDowodow({ szczegol, trwa, blad, idZdjecia, onPokaz, onDodaj, onUsun }: {
  szczegol: SzczegolReklamacji;
  /** Zapis dowodu w drodze — przyciski czekają, żeby nie wysłać go dwa razy. */
  trwa: boolean;
  blad: string;
  /** Identyfikator miejsca zdjęcia w DOM — ten sam, do którego prowadzi wątek. */
  idZdjecia: (zalacznikId: number) => string;
  onPokaz: (zalacznikId: number) => void;
  /** `gotowe` czyści pole, ale dopiero po udanym zapisie — porażka zostawia tekst. */
  onDodaj: (tresc: string, zalacznikId: number | null, gotowe: () => void) => void;
  onUsun: (dowodId: number) => void;
}) {
  const r = szczegol.reklamacja;
  /* Czytamy ostrożnie: starszy serwer pola nie zna, a jego brak ma wyglądać
     jak pusta lista wpisów, a nie wywracać kolumny. */
  const dowody: DowodReklamacji[] = szczegol.dowody ?? [];
  const { grupy, znaki, poNumerze } = zdjeciaSprawy(szczegol);
  const twId = twIdSprawy(szczegol);
  const [tresc, setTresc] = useState("");
  const [zalacznik, setZalacznik] = useState("");
  const idPola = useId();
  const dlugosc = tresc.trim().length;
  const zaDlugi = dlugosc > LIMIT_DOWODU;

  const dodaj = () => {
    if (!dlugosc || zaDlugi) return;
    onDodaj(tresc.trim(), zalacznik ? Number(zalacznik) : null, () => {
      setTresc(""); setZalacznik("");
    });
  };

  return <div className="flex flex-col gap-4 px-3 py-3">
    <section aria-label="Dowody" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">Dowody</h2>
        <span className="text-podpis text-slate-600">
          {ile(poNumerze.length, "zdjęcie", "zdjęcia", "zdjęć")} · {ile(dowody.length, "wpis", "wpisy", "wpisów")}
        </span>
      </div>

      {dowody.length > 0 && <ol className="flex flex-col gap-2">
        {dowody.map((d) => {
          const znak = d.zalacznikId !== null ? znaki.get(d.zalacznikId) : undefined;
          return <li key={d.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
            <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{d.tresc}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-podpis text-slate-600">
              {/* Numer zdjęcia jest PRZYCISKIEM: wpis „bok szczotki krzywy"
                  bez jednego kliknięcia do zdjęcia kazałby go szukać w kolumnie. */}
              {znak && <button type="button" onClick={() => onPokaz(d.zalacznikId!)}
                aria-label={`Pokaż zdjęcie ${znak}`}
                className="min-h-6 rounded border border-slate-300 bg-white px-1.5 font-bold tabular-nums
                  text-slate-800 hover:bg-slate-50">{znak}</button>}
              <span>{d.autor ?? "biuro"} · {czas(d.utworzonoAt)}</span>
              <button type="button" disabled={trwa} onClick={() => onUsun(d.id)}
                aria-label={`Usuń dowód: ${skrot(d.tresc)}`} title="Usuń ten wpis"
                className="ml-auto inline-flex min-h-6 items-center rounded px-1 text-slate-600
                  hover:bg-slate-100 hover:text-ranga-zle disabled:opacity-50">
                <Trash2 size={13} aria-hidden="true" /></button>
            </div>
          </li>;
        })}
      </ol>}

      <label htmlFor={idPola} className="sr-only">Nowy dowód</label>
      <textarea id={idPola} rows={3} value={tresc} onChange={(e) => setTresc(e.target.value)}
        placeholder="Co widać, czego brakuje, co ustaliliśmy…"
        className="field resize-y text-sm" />
      {dlugosc > LIMIT_DOWODU - PROG_LICZNIKA && <p className={`text-podpis font-semibold tabular-nums ${
        zaDlugi ? "text-ranga-zle" : "text-ranga-uwaga"}`}>
        {dlugosc} / {LIMIT_DOWODU}{zaDlugi ? ` — o ${dlugosc - LIMIT_DOWODU} za dużo` : ""}</p>}
      <div className="flex items-center gap-2">
        {/* LISTA, NIE PTASZEK: zdjęć bywa kilka, a wpis wskazuje jedno.
            Bez zdjęć w sprawie wyboru nie ma, bo nie byłoby z czego wybierać. */}
        {poNumerze.length > 0 && <select aria-label="Powiąż ze zdjęciem" value={zalacznik}
          onChange={(e) => setZalacznik(e.target.value)}
          className="field min-w-0 flex-1 !px-2 !py-1 text-xs">
          <option value="">bez zdjęcia</option>
          {poNumerze.map(({ z, znak, at }) =>
            <option key={z.id} value={z.id}>{`${znak} · ${dzienMiesiac(at)}`}</option>)}
        </select>}
        <Przycisk className="ml-auto !px-3 !py-1 text-xs" disabled={trwa || !dlugosc || zaDlugi}
          onClick={dodaj}>{trwa ? "Zapisuję…" : "Dodaj"}</Przycisk>
      </div>
      {blad && <p className="text-xs text-red-700">{blad}</p>}
    </section>

    <section aria-label="Wysłaliśmy" className="flex flex-col gap-1.5">
      <NaglowekSekcji jako="h3">Wysłaliśmy</NaglowekSekcji>
      <div className="flex flex-wrap gap-3">
        <figure className="flex flex-col items-center gap-1">
          <KafelOferty externalId={r.offerId} stan={r.ofertaZdjecie} rozmiar={64}
            nazwa={r.ofertaNazwa ?? "Oferta"} symbol={r.offerId} />
          <figcaption className="text-podpis text-slate-600">oferta</figcaption>
        </figure>
        {/* Kartoteka tylko wtedy, gdy wiemy, która to — pusty kafel przy
            sprawie bez kartoteki czytałby się jak „u nas nie ma zdjęcia". */}
        {twId !== null && <figure className="flex flex-col items-center gap-1">
          <Kafel twId={twId} rozmiar={64} nazwa={r.ofertaNazwa ?? "Kartoteka"} symbol={r.twSymbol} />
          <figcaption className="text-podpis text-slate-600">kartoteka</figcaption>
        </figure>}
      </div>
    </section>

    {grupy.map((g) => <section key={g.klucz} aria-label={`Zdjęcia: ${g.podpis}`}
      className="flex flex-col gap-1.5">
      <NaglowekSekcji jako="h3">{g.podpis}</NaglowekSekcji>
      {g.lista.map(({ z, znak }) =>
        /* Cel odnośnika z wątku i z wpisu. `tabIndex={-1}` przyjmuje fokus
           z kodu, ale nie dokłada przystanku tabulatora przed każdym zdjęciem. */
        <div key={z.id} id={idZdjecia(z.id)} tabIndex={-1}
          className="rounded focus:outline-none focus:ring-2 focus:ring-slate-400">
          <span className="text-podpis font-bold tabular-nums text-slate-700">{znak}</span>
          <ListaZalacznikow className="!mt-0.5">
            <ZalacznikSprawy reklamacjaId={r.id} z={z} />
          </ListaZalacznikow>
        </div>)}
    </section>)}
  </div>;
}
