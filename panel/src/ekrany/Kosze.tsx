import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Package } from "lucide-react";
import {
  useKosze, usePominiete, usePonowMmKosza, usePrzeliczKosz, useSzczegolKosza, useSzukajWKoszach,
  useUsunZMm, useZalatwPominiecie,
} from "../api/kosze";
import { Blad, Karta, Pole, Pusto, SIATKA_TRZECH_KOLUMN, SrodekIDowody, KARTA_PRACY, KARTA_DOWODOW } from "../ui";
import { FiltrZWiecej } from "../ui/FiltrZWiecej";
import { KUBELKI_KOSZY, KolejkaKoszy, KolejkaPominietych, WynikiSzukania, koszeKubelka, kubelekKosza,
  maKlopotMm, type KubelekKoszy } from "../kosze/Kolejka";
import { Kosz } from "../kosze/Kosz";
import { KontekstKosza } from "../kosze/Kontekst";
import { Koszyk, NowyKoszyk } from "../zwroty/Koszyk";
import { PrzelacznikZwrotow } from "../zwroty/Przelacznik";
import { useKursorListy } from "../nawigacja/kursor";
import { useSkaner } from "../skaner";

/** Kubełki „Tylko wgląd” — stoją pod „Więcej”, nie na wierzchu. */
const WIECEJ_KOSZY: ReadonlyArray<KubelekKoszy> = ["rozlozone", "anulowane"];

/* ── KOSZE W ZAKŁADCE ZWROTY ───────────────────────────────────────────────
   Decyzją właściciela w zakładce Zwroty — powód przy `zwroty/Przelacznik.tsx`.
   Gramatyka ta sama co w Zwrotach i Dostawach: kolejka, sprawa, kontekst.

   PASEK OTWARTEGO KOSZYKA STOI TU TAK SAMO jak na liście zwrotów. To ten sam
   komponent, bo koszyk zamyka się w jednym miejscu, jedną trasą — dwie drogi
   zamknięcia tego samego pudła to dwa miejsca, w których może się ono
   rozjechać.

   ADRES NIESIE KOSZ (`/obsluga/zwroty/kosze/:id`): odświeżenie nie gubi
   sprawy, a karta zwrotu i Do zrobienia prowadzą wprost do niego. */

export function Kosze() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const wybrany = id ? Number(id) : null;
  /* Kubełek z adresu: wiersz „Pominięta pozycja" w Do zrobienia
     prowadzi tu z `?kubelek=pominiete`. Adres czyta się RAZ, przy wejściu —
     dalej kubełek jest stanem ekranu, jak na każdej kolejce. */
  const [parametry] = useSearchParams();
  const [kubelek, setKubelek] = useState<KubelekKoszy>(() => {
    const z = parametry.get("kubelek");
    return KUBELKI_KOSZY.some((k) => k.id === z) ? (z as KubelekKoszy) : "praca";
  });
  const [fraza, setFraza] = useState("");
  /* Szukanie liczy SERWER — ćwierć sekundy przerwy, jak przy archiwum dostaw. */
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(fraza.trim()), 250); return () => clearTimeout(t); }, [fraza]);

  const kosze = useKosze();
  const pominiete = usePominiete();
  const szczegol = useSzczegolKosza(wybrany);
  const szukaj = useSzukajWKoszach(q);
  const przelicz = usePrzeliczKosz();
  const zalatw = useZalatwPominiecie();
  const [bladPrzelicz, setBladPrzelicz] = useState("");
  const [wynikPrzelicz, setWynikPrzelicz] = useState("");
  const [bladZalatw, setBladZalatw] = useState("");
  const ponow = usePonowMmKosza();
  const [bladPonow, setBladPonow] = useState("");
  const [wynikPonow, setWynikPonow] = useState("");
  const [czekaNaSprawdzenie, setCzekaNaSprawdzenie] = useState(false);
  const usunZMm = useUsunZMm();
  const [bladUsun, setBladUsun] = useState("");
  const [wynikUsun, setWynikUsun] = useState("");
  useEffect(() => {
    setBladPrzelicz(""); setWynikPrzelicz(""); setBladZalatw("");
    setBladPonow(""); setWynikPonow(""); setCzekaNaSprawdzenie(false);
    setBladUsun(""); setWynikUsun("");
  }, [id]);

  const lista = kosze.data?.kosze ?? [];
  /* Kłopot z MM niesie wiersz LISTY, nie szczegół — liczy go ta sama funkcja
     co kubełek, więc karta i kubełek nie mogą się rozjechać. */
  const problemMm = lista.find((k) => k.id === wybrany)?.problemMm ?? null;
  const bezPowrotu = lista.find((k) => k.id === wybrany)?.bezPowrotu ?? null;
  /* Bez danych licznik nie zna liczby i jej nie pokazuje — powód
     przy tych samych licznikach w `ekrany/Dostawy.tsx`. */
  const znane = kosze.data !== undefined;
  const liczniki: Record<KubelekKoszy, number | undefined> = {
    praca: znane ? lista.filter((k) => kubelekKosza(k) === "praca").length : undefined,
    pominiete: pominiete.data?.pominiete.length,
    mm: znane ? lista.filter(maKlopotMm).length : undefined,
    rozlozone: znane ? lista.filter((k) => kubelekKosza(k) === "rozlozone").length : undefined,
    anulowane: znane ? lista.filter((k) => kubelekKosza(k) === "anulowane").length : undefined,
  };
  const opis = KUBELKI_KOSZY.find((k) => k.id === kubelek);
  const idz = (x: number) => nawiguj(`/obsluga/zwroty/kosze/${x}`);
  const szuka = q.length >= 2;

  const koszeWidoczne = koszeKubelka(lista, kubelek);
  const lewa = kosze.isLoading ? <Pusto waga="lista">Wczytuję kosze…</Pusto>
    /* Błąd bez danych zamiast „ten kubełek jest pusty". */
    : kosze.error && !kosze.data ? <Blad>{(kosze.error as Error).message}</Blad>
    /* SZUKANIE I POMINIĘTE MAJĄ WŁASNE ZAPYTANIA, więc własne „nie wiem".
       „Nic nie pasuje" albo „hala niczego nie pominęła" bez danych
       to orzeczenie, którego nikt nie sprawdził. Błąd szukania stoi pod
       listą, więc tu wystarczy nie mówić nieprawdy. */
    : szuka ? (szukaj.isLoading ? <Pusto waga="lista">Szukam w koszach…</Pusto>
        : !szukaj.data ? null
        : <WynikiSzukania lista={szukaj.data.znalezione} wybranyKosz={wybrany} onWybierz={idz} />)
      : kubelek === "pominiete"
        ? (pominiete.isLoading ? <Pusto waga="lista">Wczytuję pominięte…</Pusto>
          : !pominiete.data
            ? <Blad>{(pominiete.error as Error | null)?.message ?? "Nie udało się wczytać pominiętych."}</Blad>
            : <KolejkaPominietych lista={pominiete.data.pominiete} wybranyKosz={wybrany} onWybierz={idz} />)
        : <KolejkaKoszy kosze={koszeWidoczne} wybrany={wybrany} onWybierz={idz}
            pokazBladMm={kubelek === "mm"} />;

  /* KURSOR CHODZI PO KOSZACH, KTÓRE WIDAĆ. W szukaniu i w pominiętych wiersz
     to pozycja, a otwiera się kosz, więc kilka wierszy jednego kosza liczy
     się raz. Gdy zamiast listy stoi „wczytuję" albo błąd, kursor nie ma po
     czym chodzić. */
  const bezListy = kosze.isLoading || !kosze.data
    || (szuka ? !szukaj.data : kubelek === "pominiete" && !pominiete.data);
  const idKoszy = bezListy ? []
    : szuka ? (szukaj.data?.znalezione ?? []).map((z) => z.koszId)
    : kubelek === "pominiete" ? (pominiete.data?.pominiete ?? []).map((p) => p.koszId)
    : koszeWidoczne.map((k) => k.id);
  const widoczne = [...new Set(idKoszy)].map((x) => ({ id: x }));
  /* KOSZ ZOSTAJE OTWARTY PRZY ZMIANIE LISTY, bo ten sam kosz bywa w dwóch
     kubełkach naraz. Kursor dostaje więc nazwę listy: miejsce zapamiętane
     w „W pracy" nic nie mówi o wynikach szukania ani o „Problemie z MM". */
  const kursor = useKursorListy(widoczne, wybrany, (w) => idz(w.id), szuka ? `szukaj ${q}` : kubelek);
  /* Bez otwartego kosza klawisz otwiera pierwszy wiersz. */
  const idzOWiersz = (o: number) => {
    if (wybrany !== null) return kursor(o);
    const pierwszy = widoczne[0];
    if (pierwszy) idz(pierwszy.id);
  };
  /* TE SAME KLAWISZE CO NA POZOSTAŁYCH KOLEJKACH: `j`/`k` albo strzałki po
     liście, cyfry po kubełkach.

     SKRÓTY IDĄ PRZEZ NASŁUCH CZYTNIKA, jak w zwrotach. Pasek koszyka nad
     listą ma pole skanu, a kod zeskanowany obok niego to seria cyfr: goły
     nasłuch przerzucałby kubełki przy każdym takim skanie. Hak oddaje tu
     wyłącznie klawisz, który nie był częścią serii, i milczy w polu pisania
     oraz pod oknem modalnym. Sam skan poza polem nic tu nie robi — kod czyta
     pole koszyka. */
  useSkaner(() => {}, (e) => {
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idzOWiersz(1); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idzOWiersz(-1); }
    else if (/^[1-9]$/.test(e.key)) {
      const k = KUBELKI_KOSZY[Number(e.key) - 1];
      if (k) setKubelek(k.id);
    }
  });

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {/* Jeden rząd nagłówka, jak na liście zwrotów. */}
    <div className="flex shrink-0 flex-wrap items-start gap-2">
      <PrzelacznikZwrotow teraz="kosze" />
      <NowyKoszyk />
    </div>
    <Koszyk />
    <div className={SIATKA_TRZECH_KOLUMN}>
      <Karta className="flex min-h-0 flex-col overflow-hidden">
        {/* Bez tytułu „Kosze", bo powtarzałby wybraną zakładkę
            przełącznika tuż nad nim. */}
        <nav className="flex shrink-0 flex-wrap gap-1 p-2">
          {/* „Rozłożone" i „Anulowane" pod „Więcej": oba to „Tylko wgląd".
              Ten sam komponent co w Skrzynce i reklamacjach. */}
          <FiltrZWiecej<KubelekKoszy> wybrany={kubelek} onWybierz={setKubelek}
            wiecej={WIECEJ_KOSZY}
            pozycje={KUBELKI_KOSZY.map((k) => ({ klucz: k.id, etykieta: k.etykieta,
              ile: liczniki[k.id], podpowiedz: k.pytanie }))} />
        </nav>
        <div className="shrink-0 border-t border-slate-200 p-2">
          {/* „W którym koszu jechał ten towar?" — pytanie pada po fakcie: towar
              zniknął albo klient dopomina się o zwrot. */}
          <Pole value={fraza} onChange={(e) => setFraza(e.target.value)}
            placeholder="W którym koszu? Symbol, nazwa, kod, kosz albo zwrot" aria-label="Szukaj towaru w koszach" />
        </div>
        {!szuka && <div className="shrink-0 border-y border-slate-200 bg-slate-50 px-2 py-1">
          <span className="text-xs font-semibold text-slate-600">{opis?.pytanie}</span>
        </div>}
        <div className="min-h-0 flex-1 overflow-y-auto">{lewa}</div>
        <Blad>{kosze.error && kosze.data ? (kosze.error as Error).message
          : szukaj.error ? (szukaj.error as Error).message : ""}</Blad>
      </Karta>

      <SrodekIDowody>
      <Karta className={`flex min-h-0 flex-col overflow-hidden ${KARTA_PRACY}`}>
        {wybrany === null
          ? <Pusto ikona={Package}>Wybierz kosz z kolejki.</Pusto>
          : szczegol.isLoading ? <Pusto waga="lista">Wczytuję zawartość kosza…</Pusto>
            : szczegol.data
              /* `key` NA KOSZU. Otwarty formularz i potwierdzenie zdjęcia
                 z MM należą do jednego kosza. Bez klucza przeszłyby na
                 następny kosz z tym samym towarem, z drugim krokiem już
                 otwartym. */
              ? <Kosz key={szczegol.data.kosz.id} k={szczegol.data.kosz} bezPowrotu={bezPowrotu} zalatw={{
                  trwa: zalatw.isPending, blad: bladZalatw,
                  onZalatw: (pozycjaId, notatka) => {
                    setBladZalatw("");
                    zalatw.mutate({ pozycjaId, notatka }, { onError: (e) => setBladZalatw((e as Error).message) });
                  } }} ponowMm={problemMm && wybrany !== null ? {
                  problem: problemMm, trwa: ponow.isPending, blad: bladPonow, wynik: wynikPonow,
                  czekaNaSprawdzenie,
                  usun: { trwa: usunZMm.isPending, blad: bladUsun, wynik: wynikUsun,
                    onUsun: (twId) => {
                      setBladUsun(""); setWynikUsun("");
                      usunZMm.mutate({ id: wybrany, twId }, {
                        onSuccess: (w) => setWynikUsun(w.anulowanych
                          ? "Zdjęte — MM nie miało innych pozycji, więc zostało anulowane."
                          : `Zdjęte z MM (${w.ilosc} szt.). Resztę puści „Ponów MM”, a zadanie w kolejce pójdzie samo.`),
                        onError: (e) => setBladUsun((e as Error).message),
                      });
                    } },
                  onPonow: (sprawdzono) => {
                    setBladPonow(""); setWynikPonow("");
                    ponow.mutate({ id: wybrany, sprawdzono }, {
                      onSuccess: (w) => {
                        setCzekaNaSprawdzenie(false);
                        setWynikPonow(`Ponowiono ${w.ponowione} MM — worker Sfery weźmie je za chwilę.`);
                      },
                      /* Przerwane w zapisie: serwer odmawia ZDANIEM, co sprawdzić.
                         Drugi przycisk pojawia się dopiero po tej odmowie. */
                      onError: (e) => {
                        const zdanie = (e as Error).message;
                        setBladPonow(zdanie);
                        if (/przerwano w trakcie zapisu/.test(zdanie)) setCzekaNaSprawdzenie(true);
                      },
                    });
                  } } : null} przelicz={{
                  trwa: przelicz.isPending, blad: bladPrzelicz, wynik: wynikPrzelicz,
                  onPrzelicz: () => {
                    setBladPrzelicz(""); setWynikPrzelicz("");
                    przelicz.mutate(wybrany, {
                      onSuccess: (w) => setWynikPrzelicz(`Przeliczono: ${w.przed} → ${w.po} kartotek.`),
                      /* Odmowa ma zdanie („kosz ma już dokument MM") — schowana
                         wyglądałaby jak przycisk, który nic nie robi. */
                      onError: (e) => setBladPrzelicz((e as Error).message),
                    });
                  } }} />
              : <Pusto waga="lista">{szczegol.error ? (szczegol.error as Error).message : "Nie znaleziono kosza."}</Pusto>}
      </Karta>

      <Karta className={`flex min-h-0 flex-col overflow-hidden ${KARTA_DOWODOW}`}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {szczegol.data
            ? <KontekstKosza k={szczegol.data.kosz} />
            : <Pusto waga="lista">Zwroty z kosza pokażą się po jego wybraniu.</Pusto>}
        </div>
      </Karta>
      </SrodekIDowody>
    </div>
  </div>;
}
