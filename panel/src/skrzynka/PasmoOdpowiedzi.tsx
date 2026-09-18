import React from "react";
import type { OsRozmowy } from "../api/typy";
import { useKartaTowaru } from "../api/rozmowy";
import { dzien } from "../ui";
import { parametryDoSzkicu } from "./TowarRozmowy";

/* ── PASMO ODPOWIEDZI (0.404.0) ──────────────────────────────────────────────
   Zgłoszenie właściciela ze zrzutem: „popraw skrzynkę odpowiadania pytań".

   Prawa kolumna wie wszystko i nie mówi nic pierwsza. Przy pytaniu „przyszły
   nie te prowadnice co trzeba" rozstrzygają TRZY fakty: co klient zamówił,
   czym to jest u nas i czy to mamy. Leżały wśród około czterdziestu innych,
   w tej samej wadze, pod czterema zakładkami — a stan i półka dopiero po
   przewinięciu sześciu sekcji.

   TRZY WIERSZE, NIE SKRÓT WSZYSTKIEGO. Czwarty wiersz zaczyna być drugą
   kolumną, a wtedy pasmo przestaje być pasmem. Dekalog ergonomii, punkt 2:
   pierwszeństwo ma to, co rozstrzyga bieżącą czynność.

   NAD ZAKŁADKAMI, nie w jednej z nich: te fakty są odpowiedzią na pytanie
   z rozmowy, a nie zawartością kartoteki — i mają zostać, gdy agent zajrzy
   do „Doboru" albo „Klienta".

   NIC NIE ZNIKA POD SPODEM. Sekcje zostają w tej samej kolejności i z tą samą
   treścią; pasmo je STRESZCZA, a nie zastępuje. Wiersz, którego nie mamy
   z czego złożyć, po prostu nie staje — pusta etykieta udawałaby brak
   towaru zamiast braku wiedzy.

   WSTAWKA PRZENIOSŁA SIĘ TUTAJ z dołu sekcji „Subiekt GT". Powód, dla którego
   stała pod tabelą — „agent najpierw sprawdza, czy to ta kartoteka, a dopiero
   potem przepisuje ją do odpowiedzi" — jest spełniony TU MOCNIEJ: wiersz
   „to jest" i „mamy" stoją bezpośrednio nad przyciskiem, bez przewijania.
   Wstawia dokładnie to samo co przedtem (`parametryDoSzkicu`), czyli pola
   wybrane świadomie, bo szkic idzie do klienta.                             */

/** Jeden wiersz pasma; bez wartości nie rysuje się wcale. */
function Wiersz({ etykieta, children }: { etykieta: string; children: React.ReactNode }) {
  return <div className="flex items-baseline gap-2 text-sm">
    <span className="w-16 shrink-0 text-podpis font-semibold uppercase tracking-wide text-slate-600">
      {etykieta}</span>
    <span className="min-w-0 flex-1 text-slate-900">{children}</span>
  </div>;
}

export function PasmoOdpowiedzi({ dane, onWstawDoSzkicu }: {
  dane: OsRozmowy;
  onWstawDoSzkicu: (tresc: string) => void;
}) {
  const oferta = dane.oferta;
  const k = oferta?.kartoteka;
  /* Ta sama zasada, co w `TowarRozmowy`: pasmo mówi o kartotece POTWIERDZONEJ.
     Propozycja jest do zatwierdzenia przez człowieka i nie ma prawa stanąć
     w paśmie jako fakt (§4.3, §11.3). */
  const potwierdzona = k && (k.pewnosc === "pamiec" || k.pewnosc === "sku") ? k.twId : null;
  /* To samo zapytanie, co w sekcji „Subiekt GT" niżej — TanStack trzyma je pod
     jednym kluczem, więc kolumna nie pyta serwera dwa razy. */
  const karta = useKartaTowaru(potwierdzona);

  /* Pozycja paragonu dotycząca TEJ oferty: z niej bierze się ilość i sygnatura
     z chwili zakupu. Zamówienie bywa kilkupozycyjne, a pytanie dotyczy jednej
     rzeczy. */
  const pozycja = dane.zamowienie?.pobrane?.pozycje
    .find((p) => p.offerId !== null && p.offerId === oferta?.externalId) ?? null;
  const kupiono = dane.zamowienie?.pobrane?.kupionoAt ?? null;

  const zamowil = pozycja
    ? `${pozycja.ilosc} × ${pozycja.sku ?? pozycja.offerId ?? "bez sygnatury"}`
    : null;
  const toJest = karta.data?.name ?? null;
  const mamy = karta.data
    ? karta.data.mag.avail > 0
      ? `${karta.data.mag.avail} ${karta.data.unit ?? "szt."}`
      : "brak na stanie"
    : null;

  /* Pasmo bez ani jednego wiersza to pasek z samym nagłówkiem — czyli koszt
     bez treści. Rozmowa bez oferty i bez zamówienia nie dostaje go wcale. */
  if (!zamowil && !toJest && !mamy) return null;

  return <aside aria-label="Do tej odpowiedzi"
    className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
    <div className="flex flex-col gap-1">
      {zamowil && <Wiersz etykieta="Zamówił">
        <span className="font-mono font-semibold">{zamowil}</span>
        {kupiono && <span className="text-slate-600"> · {dzien(kupiono)}</span>}
      </Wiersz>}
      {toJest && <Wiersz etykieta="To jest">
        <span className="font-semibold">{toJest}</span>
        {karta.data?.sym && <span className="font-mono text-slate-600"> · {karta.data.sym}</span>}
      </Wiersz>}
      {mamy && <Wiersz etykieta="Mamy">
        {/* Zero na stanie jest CZERWONE, nie wyciszone: to jedyny wiersz
            pasma, który sam z siebie zmienia treść odpowiedzi do klienta. */}
        <b className={karta.data && karta.data.mag.avail > 0 ? "text-ranga-ok" : "text-ranga-zle"}>
          {mamy}</b>
        {karta.data?.locs?.length ? <span className="font-mono text-slate-600">
          {" · "}{karta.data.locs.join(", ")}</span> : null}
        <button type="button"
          onClick={() => onWstawDoSzkicu(parametryDoSzkicu(karta.data!))}
          className="ml-2 font-semibold text-slate-700 underline underline-offset-2
            hover:text-slate-900">
          wstaw do szkicu</button>
      </Wiersz>}
    </div>
  </aside>;
}
