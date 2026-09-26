import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Package } from "lucide-react";
import {
  useKosze, usePominiete, usePonowMmKosza, usePrzeliczKosz, useSzczegolKosza, useSzukajWKoszach,
  useZalatwPominiecie,
} from "../api/kosze";
import { Blad, Karta, Pole, Pusto, SIATKA_TRZECH_KOLUMN } from "../ui";
import { FiltrZWiecej } from "../ui/FiltrZWiecej";
import { KUBELKI_KOSZY, KolejkaKoszy, KolejkaPominietych, WynikiSzukania, koszeKubelka, kubelekKosza,
  maKlopotMm, type KubelekKoszy } from "../kosze/Kolejka";
import { Kosz } from "../kosze/Kosz";
import { KontekstKosza } from "../kosze/Kontekst";
import { Koszyk, NowyKoszyk } from "../zwroty/Koszyk";
import { PrzelacznikZwrotow } from "../zwroty/Przelacznik";

/** Kubełki „Tylko wgląd” — stoją pod „Więcej”, nie na wierzchu (@wydanie). */
const WIECEJ_KOSZY: ReadonlyArray<KubelekKoszy> = ["rozlozone", "anulowane"];

/* ── KOSZE W ZAKŁADCE ZWROTY (0.438.0) ─────────────────────────────────────
   Przeniesione z MAGAZYNU ZWROTÓW w `biuro.html`, decyzją właściciela do
   zakładki Zwroty — powód przy `zwroty/Przelacznik.tsx`. Gramatyka ta sama co
   w Zwrotach i Dostawach: kolejka, sprawa, kontekst.

   PASEK OTWARTEGO KOSZYKA STOI TU TAK SAMO jak na liście zwrotów. To ten sam
   komponent, bo koszyk zamyka się w jednym miejscu, jedną trasą — dwie drogi
   zamknięcia tego samego pudła to dwa miejsca, w których może się ono
   rozjechać. W biurze stał przy koszu przycisk ZAMKNIJ bez obsługi; teraz
   zamyka go ten pasek.

   ADRES NIESIE KOSZ (`/obsluga/zwroty/kosze/:id`): odświeżenie nie gubi
   sprawy, a karta zwrotu i Do zrobienia prowadzą wprost do niego. */

export function Kosze() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const wybrany = id ? Number(id) : null;
  /* Kubełek z adresu (0.502.0): wiersz „Pominięta pozycja" w Do zrobienia
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
  useEffect(() => {
    setBladPrzelicz(""); setWynikPrzelicz(""); setBladZalatw("");
    setBladPonow(""); setWynikPonow(""); setCzekaNaSprawdzenie(false);
  }, [id]);

  const lista = kosze.data?.kosze ?? [];
  /* Kłopot z MM niesie wiersz LISTY, nie szczegół — liczy go ta sama funkcja
     co kubełek, więc karta i kubełek nie mogą się rozjechać (0.503.0). */
  const problemMm = lista.find((k) => k.id === wybrany)?.problemMm ?? null;
  const bezPowrotu = lista.find((k) => k.id === wybrany)?.bezPowrotu ?? null;
  const liczniki: Record<KubelekKoszy, number> = {
    praca: lista.filter((k) => kubelekKosza(k) === "praca").length,
    pominiete: pominiete.data?.pominiete.length ?? 0,
    mm: lista.filter(maKlopotMm).length,
    rozlozone: lista.filter((k) => kubelekKosza(k) === "rozlozone").length,
    anulowane: lista.filter((k) => kubelekKosza(k) === "anulowane").length,
  };
  const opis = KUBELKI_KOSZY.find((k) => k.id === kubelek);
  const idz = (x: number) => nawiguj(`/obsluga/zwroty/kosze/${x}`);
  const szuka = q.length >= 2;

  const lewa = kosze.isLoading ? <Pusto waga="lista">Wczytuję kosze…</Pusto>
    : szuka ? (szukaj.isLoading ? <Pusto waga="lista">Szukam w koszach…</Pusto>
        : <WynikiSzukania lista={szukaj.data?.znalezione ?? []} onWybierz={idz} />)
      : kubelek === "pominiete"
        ? <KolejkaPominietych lista={pominiete.data?.pominiete ?? []} wybranyKosz={wybrany} onWybierz={idz} />
        : <KolejkaKoszy kosze={koszeKubelka(lista, kubelek)} wybrany={wybrany} onWybierz={idz}
            pokazBladMm={kubelek === "mm"} />;

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {/* Jeden rząd nagłówka, jak na liście zwrotów (0.484.3). */}
    <div className="flex shrink-0 flex-wrap items-start gap-2">
      <PrzelacznikZwrotow teraz="kosze" />
      <NowyKoszyk />
    </div>
    <Koszyk />
    <div className={SIATKA_TRZECH_KOLUMN}>
      <Karta className="flex min-h-0 flex-col overflow-hidden">
        {/* Tytuł „Kosze" zszedł (@wydanie), bo powtarzał wybraną zakładkę
            przełącznika tuż nad nim — dwa razy ta sama nazwa to wiersz
            zabrany kolejce i nic nowego dla oka. */}
        <nav className="flex shrink-0 flex-wrap gap-1 p-2">
          {/* „Rozłożone" i „Anulowane" pod „Więcej" (@wydanie): oba to
              „Tylko wgląd", a stały pigułką równą koszom w pracy. Ten sam
              komponent co w Skrzynce, reklamacjach i dyskusjach. */}
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
        <Blad>{(kosze.error ?? szukaj.error) ? ((kosze.error ?? szukaj.error) as Error).message : ""}</Blad>
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-hidden">
        {wybrany === null
          ? <Pusto ikona={Package}>Wybierz kosz z kolejki.</Pusto>
          : szczegol.isLoading ? <Pusto waga="lista">Wczytuję zawartość kosza…</Pusto>
            : szczegol.data
              ? <Kosz k={szczegol.data.kosz} bezPowrotu={bezPowrotu} ponowMm={problemMm && wybrany !== null ? {
                  problem: problemMm, trwa: ponow.isPending, blad: bladPonow, wynik: wynikPonow,
                  czekaNaSprawdzenie,
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

      <Karta className="flex min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {szczegol.data
            ? <KontekstKosza k={szczegol.data.kosz} zalatw={{
                trwa: zalatw.isPending, blad: bladZalatw,
                onZalatw: (pozycjaId, notatka) => {
                  setBladZalatw("");
                  zalatw.mutate({ pozycjaId, notatka }, { onError: (e) => setBladZalatw((e as Error).message) });
                } }} />
            : <Pusto waga="lista">Zwroty i pominięte pozycje pokażą się po wybraniu kosza.</Pusto>}
        </div>
      </Karta>
    </div>
  </div>;
}
