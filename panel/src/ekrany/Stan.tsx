import React, { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useJa, useZdrowie } from "../api/rozmowy";
import { useSkokDoKarty } from "../ui/useSkokDoKarty";
import { StanIntegracji } from "../skrzynka/StanIntegracji";
import { KartaKolejki } from "../stan/Kolejka";
import { KartaArkusza } from "../stan/Arkusz";
import { KartaKolizji } from "../stan/Kolizje";
import { KartaRekoncyliacji } from "../stan/Rekoncyliacja";
import { KartaWymiany } from "../stan/Wymiana";
import { KartaAllegro } from "../stan/Allegro";
import { KartaSondy } from "../stan/Sonda";
import { KartaSerwera } from "../stan/Serwer";
import { KartaKolektorow } from "../stan/Kolektory";
import { Kafelki, doUwagi, useObszary } from "../stan/Tablica";

/* ── STAN SYSTEMU (0.441.0) ──────────────────────────────────────────────
   Przeniesiony z NADZORU w `biuro.html` — ostatni widok wglądu, który tam
   mieszkał. Tło pracy biura: to, co czeka na DECYZJĘ (zapis w błędzie,
   kolizja kodu, rozłączone Allegro), stoi też w DO DECYZJI i prowadzi tutaj.

   KOLEJNOŚĆ Z 0.427.0 (dekalog pkt 1 i 5): najpierw karty z przyciskiem,
   który ktoś musi nacisnąć, potem te, które się czyta. Arkusz lokalizacji
   stoi tuż pod kolejką, bo to ona wykonuje jego skutek. Jedno przestawienie
   względem biura: kolizje kodów idą PRZED rekoncyliacją. Kolizja czeka na
   decyzję biura (stoi też w DO DECYZJI), a rekoncyliacja jest sprawdzeniem
   uruchamianym na żądanie, którego wynik zwykle brzmi „bez rozjazdów".
   Zgubiony kolektor stoi zaraz za nią z tego samego powodu: to przycisk
   na żądanie, nie liczba do czytania.

   JEDNO MIEJSCE STANU INTEGRACJI. Tabela z `/api/health` stała od 0.168.0 za
   zębatką panelu, a stan serwera — w biurze. Człowiek szukający „czemu nie
   działa" miał dwa miejsca i żadne nie mówiło o drugim. Obie są tutaj.

   ADRES NIESIE KARTĘ (`?karta=kolejka|kody|allegro|wymiana|…`): wiersz
   DO DECYZJI prowadzi wprost do karty, a nie na górę ekranu. Biuro robiło to
   samo `data-cel`, a jego brak zgubił kiedyś licznik odpowiedzi na notatki.

   MNIEJ NARAZ (0.509.0), ta sama zasada co w skrzynce z 0.506.0. Arkusz,
   rekoncyliacja i test na żywym Allegro są zwinięte do nagłówka, bo sięga
   się po nie rzadko. Adres z `?karta=` otwiera zwiniętą kartę, bo inaczej
   wiersz DO DECYZJI prowadziłby do samego tytułu. Konto Allegro stoi teraz
   PRZED stanem integracji: niesie przycisk, a wiersz o połączeniu zszedł
   z tabeli integracji właśnie do tej karty. */

/* ── TABLICA ZAMIAST DZIESIĘCIU KART (0.538.0) ──────────────────────────
   Decyzja właściciela z 27 września 2026, wariant A z makiet: na górze
   kafelek na obszar, pod nim wyłącznie karty z czymś do zrobienia. Zdrowy
   obszar mówi jednym zdaniem na kafelku, a jego karta czeka pod kliknięciem.
   Powód i reguły tonu w `stan/Tablica.tsx`.

   KARTA RAZ POKAZANA ZOSTAJE, aż człowiek zamknie ją kafelkiem. Problem
   znikający w trakcie pracy — Allegro sparowane, kolizja rozstrzygnięta —
   zabrałby kartę spod kursora razem z wynikiem, który właśnie się pojawił.

   KOLEJNOŚĆ KART W KODZIE JEST TA Z 0.427.0 i pilnuje jej test serwera.
   Karty rysują się warunkowo, ale w tym samym porządku co kafelki. */
export function Stan() {
  const zdrowie = useZdrowie();
  const ja = useJa();
  const admin = ja.data?.user.role === "admin";
  /* Skok do karty z adresu — logika i jej uzasadnienie w `ui/useSkokDoKarty.ts`.
     Karta z adresu jest otwarta od wejścia, więc skok zastaje ją narysowaną. */
  const karta = useSkokDoKarty();
  const obszary = useObszary(admin, zdrowie.data);
  const [recznie, setRecznie] = useState<Record<string, boolean>>({});
  const [widziane, setWidziane] = useState<ReadonlySet<string>>(new Set());
  const [cel, setCel] = useState<string | null>(null);

  const problemy = obszary.filter(doUwagi).map((o) => o.id).join(",");
  useEffect(() => {
    if (!problemy) return;
    setWidziane((w) => {
      const nowe = problemy.split(",").filter((id) => !w.has(id));
      return nowe.length ? new Set([...w, ...nowe]) : w;
    });
  }, [problemy]);

  /* Problem TERAZ liczy się w samym renderze, nie dopiero z efektu. Karta
     z efektu wchodziła jeden render po swoich danych — już po skoku do
     `?karta=` — i spychała cel skoku w dół ekranu. `widziane` niesie tylko
     regułę „raz pokazana zostaje". */
  const teraz = new Set(problemy ? problemy.split(",") : []);
  const otwarta = (id: string) => recznie[id] ?? (id === karta || teraz.has(id) || widziane.has(id));
  const przelacz = (id: string) => {
    const teraz = !otwarta(id);
    setRecznie((r) => ({ ...r, [id]: teraz }));
    if (teraz) setCel(id);
  };
  /* Klik w kafelek niżej na ekranie otwiera kartę pod całym rzędem kart.
     Bez przewinięcia wyglądałoby to jak kafelek, który nic nie robi. */
  useEffect(() => {
    if (!cel) return;
    document.getElementById(`karta-${cel}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setCel(null);
  }, [cel]);

  const doUwagiIle = obszary.filter(doUwagi).length;
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <div className="flex flex-wrap items-baseline gap-3">
      <h1 className="text-tytul flex items-center gap-2 font-bold"><Activity size={20} />Stan systemu</h1>
      <span className="text-sm text-slate-600">{doUwagiIle
        ? `Do uwagi: ${doUwagiIle} z ${obszary.length}. Ich karty stoją pod spodem.`
        : "Wszystko działa. Kartę obszaru otwiera klik w kafelek."}</span>
    </div>
    <Kafelki obszary={obszary} otwarte={otwarta} przelacz={przelacz} />
    {otwarta("kolejka") && <KartaKolejki />}
    {admin && otwarta("arkusz") && <KartaArkusza otworz />}
    {otwarta("kody") && <KartaKolizji />}
    {otwarta("rekoncyliacja") && <KartaRekoncyliacji otworz />}
    {otwarta("kolektory") && <KartaKolektorow />}
    {otwarta("wymiana") && <KartaWymiany />}
    {otwarta("allegro") && <KartaAllegro admin={admin} />}
    {otwarta("integracje") && <StanIntegracji zdrowie={zdrowie.data} odczyt={zdrowie.dataUpdatedAt} />}
    {otwarta("sonda") && <KartaSondy otworz />}
    {otwarta("serwer") && <KartaSerwera zdrowie={zdrowie.data} />}
  </div>;
}
