import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Truck } from "lucide-react";
import {
  useArchiwumDostaw, useDokument, useDostawy, useNotatkaDoHali, useOdpowiedziHali, usePozaWertis,
  usePrzeczytane, usePrzywrocDostawe, useRozwiazWyjatek, useWyjatkiOtwarte, useZamknijPozaWertis,
} from "../api/dostawy";
import { Blad, Karta, Pusto, SIATKA_TRZECH_KOLUMN, SrodekIDowody, KARTA_PRACY, KARTA_DOWODOW, ile } from "../ui";
import { FiltrZWiecej } from "../ui/FiltrZWiecej";
import { KolumnaKolejki, SzukajWKolejce } from "../ui/KolumnaKolejki";
import {
  KUBELKI_DOSTAW, KolejkaDostaw, KolejkaPozaWertis, WierszeSpozaOkna, kubelekDokumentu,
  type KubelekDostaw,
} from "../dostawy/Kolejka";
import { Dokument, WyjatkiLuzem } from "../dostawy/Dokument";
import { Kontekst } from "../dostawy/Kontekst";
import { klawiszZajety, useOkno } from "../nawigacja/fokus";
import { useKursorListy } from "../nawigacja/kursor";

/** Kubełki do przeglądania — stoją pod „Więcej”, nie na wierzchu. */
const WIECEJ_DOSTAW: ReadonlyArray<KubelekDostaw> = ["zamkniete", "poza", "archiwum"];

/* ── DOSTAWY ───────────────────────────────────────────────────────────────
   Gramatyka ta sama co w Zwrotach i Reklamacjach — kolejka, sprawa, dowody —
   bo biuro przechodzi między tymi ekranami kilkadziesiąt razy dziennie,
   a trzy układy to trzy nawyki (dekalog pkt 2 i 6). DO DECYZJI stoi na
   początku kubełków, bo po to biuro tu wchodzi.

   ADRES NIESIE DOKUMENT. `dokId` z Subiekta, bo dokument nietknięty nie ma
   jeszcze `deliveryId`; `bez` to otwarte wyjątki towaru spoza dokumentu.
   Odświeżenie strony nie gubi sprawy, a link da się wkleić koledze —
   ta sama zasada co przy zwrocie i rozmowie. */

export function Dostawy() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const wybrany: number | "bez" | null = id === "bez" ? "bez" : id ? Number(id) : null;
  const dokId = typeof wybrany === "number" ? wybrany : null;

  /* Kubełek i fraza z adresu: wiersz dostawcy w Analizie prowadzi
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
     Ćwierć sekundy to próg, poniżej którego pisanie i tak trwa. */
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

  /* Otwarte wyjątki, których dokumentu lista nie zna, dostają wiersz
     w DO DECYZJI. Bez tego dokument, który
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
  /* Numer dostawcy szuka się tak samo jak nasz FZ: z nim dzwoni hurtownia. */
  const pasuje = (nr: string, kto: string, nrDostawcy?: string | null) =>
    !q || nr.toLowerCase().includes(q) || kto.toLowerCase().includes(q)
      || (nrDostawcy ?? "").toLowerCase().includes(q);
  const wKubelku = (k: KubelekDostaw) => dokumenty.filter((d) => kubelekDokumentu(d, zOdpowiedzia) === k);
  /* Bez danych licznik nie zna liczby, więc jej nie pokazuje. „0" przy
     zerwanym połączeniu mówiłoby „nic nie ma", a prawda brzmi „nie wiem". */
  const znane = lista.data !== undefined;
  const liczniki: Record<KubelekDostaw, number | undefined> = {
    decyzja: znane ? wKubelku("decyzja").length + spozaOkna.length : undefined,
    toku: znane ? wKubelku("toku").length : undefined,
    nietkniete: znane ? wKubelku("nietkniete").length : undefined,
    zamkniete: znane ? wKubelku("zamkniete").length : undefined,
    poza: poza.data?.documents.length,
    /* Archiwum bez licznika, dopóki go nie otworzyć — liczba wymagałaby
       pobrania, a pobieramy je dopiero na życzenie. */
    archiwum: kubelek === "archiwum" ? archiwum.data?.ile : undefined,
  };
  const opis = KUBELKI_DOSTAW.find((k) => k.id === kubelek);
  const idz = (x: number | "bez") => nawiguj(`/obsluga/dostawy/${x}`);

  /* JEDNA LISTA WIDOCZNA dla rysowania i dla klawiszy. Kursor chodzi po tym,
     co stoi na ekranie, w tej samej kolejności: najpierw wiersze spoza okna
     importu, potem dokumenty kubełka po odsianiu frazą. Gdy zamiast listy
     stoi „wczytuję" albo błąd, kursor nie ma po czym chodzić: klawisz nie
     może otworzyć wiersza, którego człowiek nie widzi. */
  const bezListy = lista.isLoading || Boolean(lista.error && !lista.data)
    || (kubelek === "poza" && !poza.data) || (kubelek === "archiwum" && !archiwum.data);
  const pozaWidoczne = (poza.data?.documents ?? []).filter((d) => pasuje(d.nrPelny, d.dostawca));
  const archiwumWidoczne = archiwum.data?.documents ?? [];
  const kubelekWidoczny = kubelek === "poza" || kubelek === "archiwum" ? []
    : wKubelku(kubelek).filter((d) => pasuje(d.nrPelny, d.dostawca, d.nrDostawcy));
  const widoczne: Array<{ id: number | "bez" }> = bezListy ? []
    : kubelek === "poza" ? pozaWidoczne.map((d) => ({ id: d.dokId }))
    : kubelek === "archiwum" ? archiwumWidoczne.map((d) => ({ id: d.dokId }))
    : [...(kubelek === "decyzja" ? spozaOkna.map((g) => ({ id: g.dokId ?? ("bez" as const) })) : []),
       ...kubelekWidoczny.map((d) => ({ id: d.dokId }))];
  /* Po zamknięciu ostatniego wyjątku faktura schodzi z DO DECYZJI, a `j` ma
     otworzyć tę, która stanęła na jej miejscu. Powód przy `nawigacja/kursor.ts`. */
  /* Nazwa listy dla kursora: dokument zostaje otwarty przy zmianie frazy,
     a miejsce zapamiętane przed odsianiem nic nie mówi o liście po nim. */
  const kursor = useKursorListy(widoczne, wybrany, (w) => idz(w.id), `${kubelek} ${q}`);
  /* BEZ OTWARTEJ SPRAWY KLAWISZ OTWIERA PIERWSZY WIERSZ. Kursor pamięta
     ostatnie miejsce po to, żeby przeżyć zejście sprawy z listy. Po zmianie
     kubełka sprawy nie ma wcale, a pamięć z poprzedniej listy otwierałaby
     wiersz ze środka nowej. */
  const idzOWiersz = (o: number) => {
    if (wybrany !== null) return kursor(o);
    const pierwszy = widoczne[0];
    if (pierwszy) idz(pierwszy.id);
  };

  /* Do którego kubełka należy wybrana sprawa — `null`, gdy nie wiadomo.
     Archiwum przychodzi z serwera dopiero po otwarciu kubełka, więc
     dokumentu stamtąd nie da się rozpoznać z góry. */
  const kubelekWybranego = (): KubelekDostaw | null => {
    if (wybrany === null) return null;
    if (wybrany === "bez") return "decyzja";
    const d = dokumenty.find((x) => x.dokId === wybrany);
    if (d) return kubelekDokumentu(d, zOdpowiedzia);
    if (spozaOkna.some((g) => g.dokId === wybrany)) return "decyzja";
    if (poza.data?.documents.some((x) => x.dokId === wybrany)) return "poza";
    return null;
  };

  /* ZMIANA KUBEŁKA ZAMYKA SPRAWĘ SPOZA NIEGO. Inaczej środek i prawa kolumna
     trzymałyby dokument, którego nowa lista nie zawiera, czasem
     z rozpoczętym formularzem — działałoby się na fakturze, o której
     człowiek już nie myśli. Sprawa z tego samego kubełka zostaje otwarta. */
  const wybierzKubelek = (k: KubelekDostaw) => {
    setKubelek(k);
    if (wybrany !== null && kubelekWybranego() !== k) nawiguj("/obsluga/dostawy");
  };

  /* TE SAME KLAWISZE CO W ZWROTACH I REKLAMACJACH: `j`/`k` albo strzałki po
     liście, cyfry po kubełkach. Biuro przechodzi między kolejkami bez zmiany
     nawyku. Skróty milkną w polu pisania i pod oknem modalnym, inaczej cyfra
     z notatki zmieniałaby kubełek. */
  useEffect(() => {
    const nasluch = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || klawiszZajety(e.target)) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idzOWiersz(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idzOWiersz(-1); }
      /* Cyfry liczą się z długości `KUBELKI_DOSTAW`, więc dopisanie kubełka
         nie rozjedzie klawiszy. */
      else if (/^[1-9]$/.test(e.key)) {
        const k = KUBELKI_DOSTAW[Number(e.key) - 1];
        if (k) wybierzKubelek(k.id);
      }
    };
    window.addEventListener("keydown", nasluch);
    return () => window.removeEventListener("keydown", nasluch);
  });

  /* LINK DO DOKUMENTU OTWIERA JEGO KUBEŁEK. Adres `/dostawy/9003` bez
     `?kubelek=` stawał zawsze na „Do decyzji", więc zamknięta albo nietknięta
     faktura otwierała się obok listy, na której jej nie ma. Rozstrzygamy RAZ,
     gdy lista jest znana — dalej kubełek należy do człowieka. */
  const kubelekZLinku = useRef(false);
  useEffect(() => {
    /* Czekamy, aż lista zdjętych się ROZSTRZYGNIE, nie aż się uda. Gdy padnie,
       dokument z okna importu dalej da się rozpoznać, a czekanie na dane,
       które nie przyjdą, zostawiłoby go obok cudzej listy. */
    if (kubelekZLinku.current || parametry.get("kubelek") || !lista.data || (!poza.data && !poza.error)) return;
    kubelekZLinku.current = true;
    const k = kubelekWybranego();
    if (k) setKubelek(k);
    // zależności celowo tylko te: efekt ma zadziałać raz, gdy obie listy są rozstrzygnięte
  }, [lista.data, poza.data, poza.error]);

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

  const propsRozwiaz = {
    trwa: rozwiaz.isPending, blad: bladRozwiaz,
    onRozwiaz: (pid: number, note: string) => {
      setBladRozwiaz("");
      rozwiaz.mutate({ id: pid, note }, { onError: (e) => setBladRozwiaz((e as Error).message) });
    },
  };

  const zrodloListy = kubelek === "poza" ? poza : kubelek === "archiwum" ? archiwum : lista;

  const lewa = (() => {
    if (lista.isLoading) return <Pusto waga="lista">Wczytuję dostawy…</Pusto>;
    /* Błąd BEZ danych zamiast listy: „nic nie czeka na biuro" przy zerwanym
       połączeniu brzmiałoby jak koniec pracy. */
    if (lista.error && !lista.data) return <Blad>{(lista.error as Error).message}</Blad>;
    /* KAŻDY KUBEŁEK MA WŁASNE ŹRÓDŁO I WŁASNY BŁĄD. Zdjęte dostawy i archiwum
       przychodzą osobnymi zapytaniami, więc udana lista dostaw nic o nich nie
       mówi. „Nic nie zdjęto" przy zerwanym zapytaniu ukryłoby pomyłkowe
       zdjęcie dostawy, a po to ten kubełek jest. */
    if (kubelek === "poza") {
      if (poza.isLoading) return <Pusto waga="lista">Wczytuję zdjęte dostawy…</Pusto>;
      if (!poza.data) return <Blad>{(poza.error as Error | null)?.message ?? "Nie udało się wczytać zdjętych dostaw."}</Blad>;
      return <KolejkaPozaWertis wybrany={dokId} onWybierz={idz} lista={pozaWidoczne} />;
    }
    if (kubelek === "archiwum") {
      /* Archiwum przychodzi z serwera już zawężone — filtrowanie go jeszcze
         raz zawężałoby stronę wyników, a nie zbiór. */
      if (archiwum.isLoading) return <Pusto waga="lista">Wczytuję archiwum…</Pusto>;
      /* „Archiwum jest puste" bez danych to orzeczenie, że faktury nie ma. */
      if (!archiwum.data) return <Blad>{(archiwum.error as Error | null)?.message ?? "Nie udało się wczytać archiwum."}</Blad>;
      return <KolejkaDostaw dokumenty={archiwumWidoczne} zOdpowiedzia={zOdpowiedzia}
        wybrany={dokId} onWybierz={idz}
        pusto={frazaArchiwum ? "Nic w archiwum nie pasuje do wyszukiwania."
          : "Archiwum jest puste — nic jeszcze nie wypadło z okna importu."} />;
    }
    return <>
      {kubelek === "decyzja" && <WierszeSpozaOkna grupy={spozaOkna} wybrany={wybrany} onWybierz={idz} />}
      <KolejkaDostaw dokumenty={kubelekWidoczny}
        zOdpowiedzia={zOdpowiedzia} wybrany={dokId} onWybierz={idz}
        pusto={kubelek === "decyzja" && spozaOkna.length ? ""
          : kubelek === "decyzja" ? "Nic nie czeka na biuro — hala rozkłada bez pytań."
          : "Ten kubełek jest pusty."} />
    </>;
  })();

  /* Stopka mówi, GDZIE KOŃCZY SIĘ TO, NA CO PATRZYSZ. Obcięte archiwum
     wygląda z ekranu jak pełne — a to jest dokładnie ta pomyłka, po której
     ktoś orzeka, że faktury nie ma. Stoi w paśmie nad listą, obok pytania. */
  /* „Poza WERTIS" nie ma okna importu: serwer oddaje każdą zdjętą dostawę,
     także sprzed miesięcy, więc zdanie o czternastu dniach mówiłoby
     nieprawdę o granicy listy. */
  /* Bez danych stopka milczy: „0 zdjętych" przy zerwanym zapytaniu byłoby
     liczbą, której nikt nie policzył. */
  const stopka = kubelek === "poza"
    ? poza.data && `${ile(poza.data.documents.length, "zdjęta", "zdjęte", "zdjętych")} z listy — bez granicy okna importu`
    : kubelek === "archiwum"
    ? archiwum.data && (archiwum.data.ile > archiwum.data.documents.length
        ? `pokazano ${archiwum.data.documents.length} z ${archiwum.data.ile} — zawęź wyszukiwaniem`
        : `${ile(archiwum.data.ile, "dostawa", "dostawy", "dostaw")} starszych niż ${lista.data?.dniWstecz ?? 14} dni`)
    : `okno importu: ostatnie ${lista.data?.dniWstecz ?? 14} dni`;

  const luzem = wybrany === "bez"
    ? (wyjatki.data?.problems ?? []).filter((p) => p.dokId == null) : [];

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    <div className={SIATKA_TRZECH_KOLUMN}>
      {/* Kolumna listy z jednej formy (`ui/KolumnaKolejki.tsx`). Bez tytułu
          „Dostawy”, bo powtarzałby podświetloną zakładkę menu, a kolejka nie ma
          działań do postawienia w jego rzędzie. */}
      <KolumnaKolejki etykieta="Kolejka dostaw"
        /* „Zamknięte", „Poza WERTIS" i „Archiwum" pod „Więcej":
           to przeglądanie, nie praca. „Poza WERTIS" zostaje o jedno
           kliknięcie z licznikiem w opcji, bo ma wyłapać pomyłkowe
           zdjęcie dostawy. */
        kubelki={<FiltrZWiecej<KubelekDostaw> zwarty wybrany={kubelek} onWybierz={wybierzKubelek}
          wiecej={WIECEJ_DOSTAW}
          pozycje={KUBELKI_DOSTAW.map((k) => ({ klucz: k.id, etykieta: k.etykieta, ile: liczniki[k.id],
            podpowiedz: k.pytanie }))} />}
        szukaj={<SzukajWKolejce wartosc={fraza} onZmien={setFraza} etykieta="Szukaj dostawy"
          placeholder={kubelek === "archiwum" ? "Szukaj w archiwum: numer albo dostawca" : "Numer FZ, faktury dostawcy albo dostawca"} />}
        /* PYTANIE KUBEŁKA I STOPKA W JEDNYM PAŚMIE, bo mówią o tej samej
           liście: „co z nią zrobić" i „gdzie się kończy". Granica okna stoi
           NAD listą, więc ucięte archiwum widać, zanim zacznie się ją
           czytać. */
        drugi={<>
          <span className="font-semibold text-xs text-slate-600">{opis?.pytanie}</span>
          <span className="ml-auto text-xs text-slate-600">{stopka}</span>
        </>}>
        {lewa}
        {/* Pod listą tylko błąd odświeżenia, gdy dane zostały; bez danych
            błąd stoi zamiast listy. Mówi o źródle listy, którą widać: po
            przywróceniu dostawy nieodświeżona lista zdjętych dalej by ją
            pokazywała. */}
        <Blad>{zrodloListy.error && zrodloListy.data ? (zrodloListy.error as Error).message : ""}</Blad>
      </KolumnaKolejki>

      <SrodekIDowody>
      <Karta className={`flex min-h-0 flex-col overflow-hidden ${KARTA_PRACY}`}>
        {wybrany === null
          ? <Pusto ikona={Truck}>Wybierz dostawę z kolejki.</Pusto>
          : wybrany === "bez"
            /* Bez danych nie mówimy „nie ma wyjątków": przy zerwanym połączeniu
               to zdanie znaczyłoby koniec pracy, a prawda brzmi „nie wiem". */
            ? wyjatki.isLoading
              ? <Pusto waga="lista">Wczytuję wyjątki…</Pusto>
              : !wyjatki.data
                ? <Pusto waga="lista">{(wyjatki.error as Error | null)?.message ?? "Nie udało się wczytać wyjątków."}</Pusto>
                : <WyjatkiLuzem tytul="Towar spoza dokumentu"
                    podtytul="Hala zgłosiła towar, którego nie było na żadnej fakturze. Rozstrzygnij każdy z osobna."
                    lista={luzem} rozwiaz={propsRozwiaz} onPowieksz={setLupa} />
            : dokument.isLoading
              ? <Pusto waga="lista">Wczytuję dokument…</Pusto>
              : dokument.data
                ? <Dokument key={dokument.data.dokId} d={dokument.data} rozwiaz={propsRozwiaz} onPowieksz={setLupa} />
                : <Pusto waga="lista">{dokument.error
                    ? (dokument.error as Error).message : "Nie znaleziono dokumentu."}</Pusto>}
      </Karta>

      <Karta className={`flex min-h-0 flex-col overflow-hidden ${KARTA_DOWODOW}`}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {dokument.data && typeof wybrany === "number"
            /* `key` NA DOKUMENCIE. Bez niego pole notatki i otwarty formularz
               „Zamknij dostawę" przeszłyby na następnie wybraną fakturę, gdy
               ta jest już w pamięci podręcznej. Stan formularzy należy do
               jednej faktury i ma umrzeć razem z jej wyborem. */
            ? <Kontekst key={dokument.data.dokId} d={dokument.data} onPowieksz={setLupa}
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
            /* Towar spoza dokumentu nie ma faktury, więc nie ma też dostawcy
               ani notatek. Obietnica „pokażą się" kazałaby na nie czekać. */
            : <Pusto waga="lista">{wybrany === "bez"
                ? "Towar spoza dokumentu nie ma dostawcy ani notatek. Zdjęcie z hali stoi przy wyjątku."
                : "Dowody, dostawca i notatki pokażą się po wybraniu dostawy."}</Pusto>}
        </div>
      </Karta>
      </SrodekIDowody>
    </div>

    {/* Powiększenie dowodu: „czy to TA część" przy kartotekach różniących się
        końcówką nazwy nie rozstrzyga się na miniaturze. Zamyka KAŻDE
        kliknięcie i Escape. */}
    {lupa && <Lupa src={lupa} onZamknij={() => setLupa(null)} />}
  </div>;
}

/* Lupa jest oknem, nie gołym przyciskiem na cały ekran: fokus ma wejść do
   środka, a Tab nie może iść po niewidocznej stronie. Przycisk zostaje
   w środku: zamyka KAŻDE kliknięcie, Enter i Escape. */
function Lupa({ src, onZamknij }: { src: string; onZamknij: () => void }) {
  const okno = useOkno<HTMLDivElement>({ onZamknij });
  return <div role="dialog" {...okno} aria-label="Zdjęcie z hali — powiększenie" className="fixed inset-0 z-30">
    <button type="button" onClick={onZamknij} aria-label="Zamknij powiększenie" data-fokus-startowy
      className="grid h-full w-full place-items-center bg-black/70 p-8">
      <img src={src} alt="Zdjęcie z hali — powiększenie" className="max-h-full max-w-full rounded-lg" />
    </button>
  </div>;
}
