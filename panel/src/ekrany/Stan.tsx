import React from "react";
import { Activity } from "lucide-react";
import { useJa, useZdrowie } from "../api/rozmowy";
import { Karta } from "../ui";
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

export function Stan() {
  const zdrowie = useZdrowie();
  const ja = useJa();
  const admin = ja.data?.user.role === "admin";
  /* Skok do karty z adresu — logika i jej uzasadnienie w `ui/useSkokDoKarty.ts`.
     Ta sama nazwa karty otwiera kartę zwiniętą, zanim skok w nią wyceluje. */
  const karta = useSkokDoKarty();

  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <Activity size={18} /><b className="text-naglowek">Stan systemu</b>
      <span className="text-sm text-slate-500">Tło pracy biura. To, co czeka na decyzję, stoi też w DO DECYZJI.</span>
    </Karta>
    <KartaKolejki />
    {admin && <KartaArkusza otworz={karta === "arkusz"} />}
    <KartaKolizji />
    <KartaRekoncyliacji otworz={karta === "rekoncyliacja"} />
    <KartaKolektorow />
    <KartaWymiany />
    <KartaAllegro admin={admin} />
    <StanIntegracji zdrowie={zdrowie.data} odczyt={zdrowie.dataUpdatedAt} />
    <KartaSondy otworz={karta === "sonda"} />
    <KartaSerwera zdrowie={zdrowie.data} />
  </div>;
}
