import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Truck } from "lucide-react";
import {
  useArchiwumDostaw, useDokument, useDostawy, useNotatkaDoHali, useOdpowiedziHali, usePozaWertis,
  usePrzeczytane, usePrzywrocDostawe, useRozwiazWyjatek, useWyjatkiOtwarte, useZamknijPozaWertis,
} from "../api/dostawy";
import { Blad, FiltrSegmentowy, Karta, Pole, Pusto, SIATKA_TRZECH_KOLUMN, ile } from "../ui";
import {
  KUBELKI_DOSTAW, KolejkaDostaw, KolejkaPozaWertis, WierszeSpozaOkna, kubelekDokumentu,
  type KubelekDostaw,
} from "../dostawy/Kolejka";
import { Dokument, WyjatkiLuzem } from "../dostawy/Dokument";
import { Kontekst } from "../dostawy/Kontekst";

/* ── DOSTAWY W PANELU (0.435.0) ────────────────────────────────────────────
   Pierwszy widok biura po przeprowadzce (`docs/obsluga-klienta.md` §7).
   Gramatyka ta sama co w Zwrotach i Reklamacjach — kolejka, sprawa, dowody —
   bo biuro przechodzi między tymi ekranami kilkadziesiąt razy dziennie,
   a trzy układy to trzy nawyki (dekalog pkt 2 i 6).

   Co przeszło z `biuro.html` i dokąd:
   - lista DO ROZŁOŻENIA z czipami → kolejka z kubełkami, z DO DECYZJI na
     początku, bo po to biuro tu wchodzi;
   - karta ODPOWIEDZI NA NOTATKI → sygnał „odpowiedź z hali" w wierszu
     i przycisk PRZECZYTANE w rozmowie z halą, przy dokumencie;
   - karta REKLAMACJE → wyjątki w dokumencie, protokół w jego nagłówku;
   - karta ROZŁOŻONE POZA WERTIS → kubełek, a PRZYWRÓĆ przy dokumencie.

   ADRES NIESIE DOKUMENT. `dokId` z Subiekta, bo dokument nietknięty nie ma
   jeszcze `deliveryId`; `bez` to otwarte wyjątki towaru spoza dokumentu.
   Odświeżenie strony nie gubi sprawy, a link da się wkleić koledze —
   ta sama zasada co przy zwrocie i rozmowie. */

export function Dostawy() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const wybrany: number | "bez" | null = id === "bez" ? "bez" : id ? Number(id) : null;
  const dokId = typeof wybrany === "number" ? wybrany : null;

  /* Kubełek i fraza z adresu (@wydanie): wiersz dostawcy w Analizie prowadzi
     tu z `?kubelek=archiwum&q=<dostawca>`. Adres czyta się RAZ, przy wejściu,
     jak w koszach — dalej to stan ekranu. */
  const [parametry] = useSearchParams();
  const [kubelek, setKubelek] = useState<KubelekDostaw>(() => {
    const z = parametry.get("kubelek");
    return (["decyzja", "toku", "nietkniete", "zamkniete", "poza", "archiwum"] as const)
      .find((k) => k === z) ?? "decyzja";
  });
  const [fraza, setFraza] = useState(() => parametry.get("q") ?? "");
  /* Archiwum szuka SERWER, więc każde naciśnięcie klawisza byłoby żądaniem.
     Ćwierć sekundy to próg, poniżej którego pisanie i tak trwa — wzięty
     z biura, gdzie działa od 0.121.0. */
  const [frazaArchiwum, setFrazaArchiwum] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFrazaArchiwum(fraza.trim()), 250);
    return () => clearTimeout(t);
  }, [fraza]);

  const lista = useDostawy();
  const wyjatki = useWyjatkiOtwarte();
  const odpowiedzi = useOdpowiedziHali();
  const poza = usePozaWertis();
  const archiwum = useArchiwumDostaw(frazaArchiwum, kubelek === "archiwum");
  const dokument = useDokument(dokId);

  const dokumenty = lista.data?.documents ?? [];
  const zOdpowiedzia = useMemo(
    () => new Set((odpowiedzi.data?.odpowiedzi ?? []).map((o) => o.dokId)), [odpowiedzi.data]);

  /* Otwarte wyjątki, których dokumentu lista nie zna — w biurze stały w karcie
     REKLAMACJE, tu dostają wiersz w DO DECYZJI. Bez tego dokument, który
     wypadł z okna importu, zabrałby swój wyjątek z ekranu. */
  const spozaOkna = useMemo(() => {
    const naLiscie = new Set(dokumenty.map((d) => d.dokId));
    const grupy = new Map<string, { dokId: number | null; nr: string; ile: number }>();
    for (const p of wyjatki.data?.problems ?? []) {
      if (p.dokId != null && naLiscie.has(p.dokId)) continue;
      const k = p.dokId == null ? "bez" : String(p.dokId);
      const g = grupy.get(k) ?? { dokId: p.dokId, nr: p.docNumber ?? "Bez dokumentu", ile: 0 };
      g.ile += 1;
      grupy.set(k, g);
    }
    return [...grupy.values()];
  }, [dokumenty, wyjatki.data]);

  const q = fraza.trim().toLowerCase();
  const pasuje = (nr: string, kto: string) =>
    !q || nr.toLowerCase().includes(q) || kto.toLowerCase().includes(q);
  const wKubelku = (k: KubelekDostaw) => dokumenty.filter((d) => kubelekDokumentu(d, zOdpowiedzia) === k);
  const liczniki: Record<KubelekDostaw, number | undefined> = {
    decyzja: wKubelku("decyzja").length + spozaOkna.length,
    toku: wKubelku("toku").length,
    nietkniete: wKubelku("nietkniete").length,
    zamkniete: wKubelku("zamkniete").length,
    poza: poza.data?.documents.length ?? 0,
    /* Archiwum bez licznika, dopóki go nie otworzyć — liczba wymagałaby
       pobrania, a pobieramy je dopiero na życzenie. */
    archiwum: kubelek === "archiwum" ? archiwum.data?.ile : undefined,
  };
  const opis = KUBELKI_DOSTAW.find((k) => k.id === kubelek);
  const idz = (x: number | "bez") => nawiguj(`/obsluga/dostawy/${x}`);

  const rozwiaz = useRozwiazWyjatek();
  const notatka = useNotatkaDoHali();
  const przeczytane = usePrzeczytane();
  const zamknij = useZamknijPozaWertis();
  const przywroc = usePrzywrocDostawe();
  const [bladRozwiaz, setBladRozwiaz] = useState("");
  const [bladNotatki, setBladNotatki] = useState("");
  const [bladPoza, setBladPoza] = useState("");
  const [lupa, setLupa] = useState<string | null>(null);
  /* Zmiana sprawy czyści zdania o porażkach poprzedniej — błąd przy innej
     fakturze, który stoi dalej na ekranie, mówiłby nieprawdę o tej. */
  useEffect(() => { setBladRozwiaz(""); setBladNotatki(""); setBladPoza(""); }, [id]);
  useEffect(() => {
    if (!lupa) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setLupa(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [lupa]);

  const propsRozwiaz = {
    trwa: rozwiaz.isPending, blad: bladRozwiaz,
    onRozwiaz: (pid: number, note: string) => {
      setBladRozwiaz("");
      rozwiaz.mutate({ id: pid, note }, { onError: (e) => setBladRozwiaz((e as Error).message) });
    },
  };

  const lewa = (() => {
    if (lista.isLoading) return <Pusto waga="lista">Wczytuję dostawy…</Pusto>;
    if (kubelek === "poza") {
      return <KolejkaPozaWertis wybrany={dokId} onWybierz={idz}
        lista={(poza.data?.documents ?? []).filter((d) => pasuje(d.nrPelny, d.dostawca))} />;
    }
    if (kubelek === "archiwum") {
      /* Archiwum przychodzi z serwera już zawężone — filtrowanie go jeszcze
         raz zawężałoby stronę wyników, a nie zbiór. */
      if (archiwum.isLoading) return <Pusto waga="lista">Wczytuję archiwum…</Pusto>;
      return <KolejkaDostaw dokumenty={archiwum.data?.documents ?? []} zOdpowiedzia={zOdpowiedzia}
        wybrany={dokId} onWybierz={idz}
        pusto={frazaArchiwum ? "Nic w archiwum nie pasuje do wyszukiwania."
          : "Archiwum jest puste — nic jeszcze nie wypadło z okna importu."} />;
    }
    return <>
      {kubelek === "decyzja" && <WierszeSpozaOkna grupy={spozaOkna} wybrany={wybrany} onWybierz={idz} />}
      <KolejkaDostaw dokumenty={wKubelku(kubelek).filter((d) => pasuje(d.nrPelny, d.dostawca))}
        zOdpowiedzia={zOdpowiedzia} wybrany={dokId} onWybierz={idz}
        pusto={kubelek === "decyzja" && spozaOkna.length ? ""
          : kubelek === "decyzja" ? "Nic nie czeka na biuro — hala rozkłada bez pytań."
          : "Ten kubełek jest pusty."} />
    </>;
  })();

  /* Stopka mówi, GDZIE KOŃCZY SIĘ TO, NA CO PATRZYSZ. Obcięte archiwum
     wygląda z ekranu jak pełne — a to jest dokładnie ta pomyłka, po której
     ktoś orzeka, że faktury nie ma. */
  const stopka = kubelek === "archiwum"
    ? archiwum.data && (archiwum.data.ile > archiwum.data.documents.length
        ? `pokazano ${archiwum.data.documents.length} z ${archiwum.data.ile} — zawęź wyszukiwaniem`
        : `${ile(archiwum.data.ile, "dostawa", "dostawy", "dostaw")} starszych niż ${lista.data?.dniWstecz ?? 14} dni`)
    : `okno importu: ostatnie ${lista.data?.dniWstecz ?? 14} dni`;

  const luzem = wybrany === "bez"
    ? (wyjatki.data?.problems ?? []).filter((p) => p.dokId == null) : [];

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    <div className={SIATKA_TRZECH_KOLUMN}>
      <Karta className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
          <Truck size={18} /><b className="text-naglowek">Dostawy</b>
        </div>
        <nav className="flex shrink-0 flex-wrap gap-1 p-2">
          <FiltrSegmentowy<KubelekDostaw> wybrany={kubelek} onWybierz={setKubelek}
            pozycje={KUBELKI_DOSTAW.map((k) => ({ klucz: k.id, etykieta: k.etykieta, ile: liczniki[k.id],
              podpowiedz: k.pytanie }))} />
        </nav>
        <div className="shrink-0 border-t border-slate-200 p-2">
          <Pole value={fraza} onChange={(e) => setFraza(e.target.value)}
            placeholder={kubelek === "archiwum" ? "Szukaj w archiwum: numer albo dostawca" : "Numer albo dostawca"}
            aria-label="Szukaj dostawy" />
        </div>
        <div className="shrink-0 border-y border-slate-200 bg-slate-50 px-2 py-1">
          <span className="text-xs font-semibold text-slate-600">{opis?.pytanie}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{lewa}</div>
        <p className="shrink-0 border-t border-slate-200 px-3 py-1.5 text-xs text-slate-600">{stopka}</p>
        <Blad>{lista.error ? (lista.error as Error).message : ""}</Blad>
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-hidden">
        {wybrany === null
          ? <Pusto ikona={Truck}>Wybierz dostawę z kolejki.</Pusto>
          : wybrany === "bez"
            ? <WyjatkiLuzem tytul="Towar spoza dokumentu"
                podtytul="Hala zgłosiła towar, którego nie było na żadnej fakturze. Rozstrzygnij każdy z osobna."
                lista={luzem} rozwiaz={propsRozwiaz} />
            : dokument.isLoading
              ? <Pusto waga="lista">Wczytuję dokument…</Pusto>
              : dokument.data
                ? <Dokument d={dokument.data} rozwiaz={propsRozwiaz} />
                : <Pusto waga="lista">{dokument.error
                    ? (dokument.error as Error).message : "Nie znaleziono dokumentu."}</Pusto>}
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {dokument.data && typeof wybrany === "number"
            ? <Kontekst d={dokument.data} onPowieksz={setLupa}
                notatka={{ trwa: notatka.isPending, blad: bladNotatki,
                  onWyslij: (tresc) => notatka.mutateAsync({ dokId: dokument.data!.dokId, tresc })
                    .then(() => { setBladNotatki(""); return true; })
                    .catch((e) => { setBladNotatki((e as Error).message); return false; }) }}
                przeczytane={{ trwa: przeczytane.isPending, onPrzeczytane: (n) => przeczytane.mutate(n) }}
                pozaWertis={{ trwa: zamknij.isPending || przywroc.isPending, blad: bladPoza,
                  onZamknij: (powod) => { setBladPoza(""); zamknij.mutate({ dokId: dokument.data!.dokId, powod },
                    { onError: (e) => setBladPoza((e as Error).message) }); },
                  onPrzywroc: () => { setBladPoza(""); przywroc.mutate(dokument.data!.dokId,
                    { onError: (e) => setBladPoza((e as Error).message) }); } }} />
            : <Pusto waga="lista">Dowody, dostawca i notatki pokażą się po wybraniu dostawy.</Pusto>}
        </div>
      </Karta>
    </div>

    {/* Powiększenie dowodu: „czy to TA część" przy kartotekach różniących się
        końcówką nazwy nie rozstrzyga się na miniaturze (0.205.0). Zamyka
        KAŻDE kliknięcie i Escape — tak jak w biurze. */}
    {lupa && <button type="button" onClick={() => setLupa(null)} aria-label="Zamknij powiększenie"
      className="fixed inset-0 z-30 grid place-items-center bg-black/70 p-8">
      <img src={lupa} alt="Zdjęcie z hali — powiększenie" className="max-h-full max-w-full rounded-lg" />
    </button>}
  </div>;
}
