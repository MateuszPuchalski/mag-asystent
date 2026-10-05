import React from "react";
import type { SzczegolReklamacji, WiadomoscReklamacji } from "../api/typy";
import { zlote } from "../api/zwroty";
import { czas, dniSlowo, LoginKlienta, Skopiuj } from "../ui";
import { Prowadzi } from "../sprawy/Prowadzi";
import { mojaSprawa } from "../sprawy/Moje";
import { PrzyciskTowaru } from "../towar/Szuflada";
import { OCZEKIWANIA, POWODY } from "./Kolejka";

/* ── Głowica sprawy: co, kto i gdzie stoimy ──────────────────────────────────
   Jeden pas na całą szerokość obszaru sprawy, nad rozmową, dowodami
   i faktami. Odpowiada na trzy pytania zadawane przy KAŻDYM otwarciu, zanim
   agent przeczyta choćby jedno zdanie klienta: o jaki towar chodzi, czego
   klient chce i czyj jest ruch. Dlatego stoi nad trzema kolumnami, a nie
   w jednej z nich — każda z nich czyta się dopiero na tym tle.

   ZDJĘĆ TU NIE MA. Obraz oferty i kartoteki stoi w kolumnie zdjęć pod
   „Wysłaliśmy", obok tego, co przysłał klient — tam się je porównuje.
   Cena też nie: wiersz towaru mówi, CO to jest, a ile kosztowało, mówią
   kwota na wierszu kolejki i fakty po prawej. Jeden dom na jeden fakt.

   TERMIN DECYZJI tylko przed werdyktem. Po nim liczba dni do terminu nie
   rozstrzyga już niczego, a czerwona stałaby przy sprawie zamkniętej. */

/* ── JEDNA KARTOTEKA NA CAŁĄ KOLUMNĘ ─────────────────────────────────────────
   Symbol, kafel, przekrój towaru, triaż i zlecenie hali pytają o TĘ SAMĄ
   rzecz: która to kartoteka u nas. Każdy element pyta tej funkcji, bo
   osobne pytania się rozjeżdżają. Symbol z dopasowania po SKU obok „sprawa
   bez kartoteki" to dwie sprzeczne odpowiedzi w jednym wierszu.

   KOLEJNOŚĆ ZA SERWEREM: najpierw `r.twId`, który niesie paragon albo
   wskazanie człowieka, potem `kartotekaOferty`. Z niej bierzemy wyłącznie
   POWIĄZANIE, czyli `sku` i `pamiec`. Jedno trafienie po sygnaturze to
   decyzja właściciela, nie propozycja (`services/dopasowanie-sku.ts`).
   Symbol zdublowany przychodzi bez `twId` i zostaje brakiem, bo dwie
   kartoteki pod jednym symbolem rozstrzyga człowiek. */
export type ZrodloKartoteki = "paragon" | "mapowanie" | "sku";

export interface KartotekaKolumny {
  twId: number | null;
  symbol: string | null;
  zrodlo: ZrodloKartoteki | null;
}

export const NAPIS_ZRODLA: Record<ZrodloKartoteki, string> = {
  paragon: "z paragonu",
  mapowanie: "z mapowania oferty",
  sku: "z SKU oferty",
};

export function kartotekaKolumny(szczegol: Pick<SzczegolReklamacji, "reklamacja" | "kartoteka">): KartotekaKolumny {
  const r = szczegol.reklamacja;
  if (r.twId !== null) {
    return { twId: r.twId, symbol: r.twSymbol, zrodlo: r.twZParagonu ? "paragon" : "mapowanie" };
  }
  const k = szczegol.kartoteka;
  if (k && k.twId !== null && (k.pewnosc === "sku" || k.pewnosc === "pamiec")) {
    return { twId: k.twId, symbol: k.symbol, zrodlo: k.pewnosc === "sku" ? "sku" : "mapowanie" };
  }
  return { twId: null, symbol: null, zrodlo: null };
}

/** Sam numer kartoteki — dla miejsc, które nie pokazują symbolu. */
export function twIdSprawy(s: Pick<SzczegolReklamacji, "reklamacja" | "kartoteka">): number | null {
  return kartotekaKolumny(s).twId;
}

/** Werdykt Allegro poza panelem — wtedy `werdykt` jest pusty, a sprawa zamknięta. */
const ROZSTRZYGNIETE: Record<string, string> = {
  CLAIM_ACCEPTED: "uznana", CLAIM_REJECTED: "odrzucona",
};

/** Kto ma ostatnie słowo — szukamy człowieka, automat Allegro nie czeka na nikogo. */
const OSTATNIE_SLOWO: Record<string, string> = {
  BUYER: "klient", SELLER: "my", ADMIN: "doradca Allegro",
};

function ostatnieSlowo(czat: WiadomoscReklamacji[]): WiadomoscReklamacji | null {
  for (let i = czat.length - 1; i >= 0; i -= 1) {
    if (OSTATNIE_SLOWO[czat[i].autorRola ?? ""]) return czat[i];
  }
  return null;
}

/**
 * Termin jednym słowem — „za 6 dni" zamiast „24.09.2026, 23:59".
 *
 * Pytanie przy sprawie brzmi „ile mam czasu", nie „który to dzień", więc
 * odejmowanie dat w głowie to praca, którą głowica ma zdjąć. Data bezwzględna
 * stoi obok, bo czasem jest potrzebna.
 */
function terminSlowem(r: SzczegolReklamacji["reklamacja"]): { napis: string; pilny: boolean } {
  if (r.poTerminie) return { napis: "po terminie", pilny: true };
  if (r.decyzjaDo === null || r.dniDoTerminu === null) return { napis: "bez terminu", pilny: false };
  if (r.dniDoTerminu === 0) return { napis: "dziś", pilny: true };
  return { napis: `za ${dniSlowo(r.dniDoTerminu)}`, pilny: r.dniDoTerminu <= 3 };
}

/** Kropka między członami — dla oka, nie dla czytnika ekranu. */
const Kropka = () => <span aria-hidden="true" className="text-slate-500">·</span>;

export function Glowica({ szczegol, mojeId = null, trwa, blad = "", onProwadze }: {
  szczegol: SzczegolReklamacji;
  /** Konto patrzącego — po nim „Ty" i „Odłóż sprawę" zamiast cudzego imienia. */
  mojeId?: number | null;
  trwa: boolean;
  blad?: string;
  onProwadze: () => void;
}) {
  const r = szczegol.reklamacja;
  const numer = r.numer ?? r.externalId;
  const powod = r.powodTyp ? (POWODY[r.powodTyp] ?? r.powodTyp) : null;
  const oczekiwanie = r.oczekiwanie ? (OCZEKIWANIA[r.oczekiwanie] ?? r.oczekiwanie) : null;
  const kwota = r.oczekiwanaKwotaGrosze !== null ? zlote(r.oczekiwanaKwotaGrosze, r.waluta) : null;
  const towar = kartotekaKolumny(szczegol);

  /* Werdykt NASZ ma pierwszeństwo przed statusem Allegro, bo niesie nazwę
     z panelu; nieudana próba werdyktem nie jest. Werdykt z Centrum Sprzedaży
     mówi o sobie wprost — pochodzenie decyzji jest informacją. */
  const naszWerdykt = r.werdyktNazwa && r.werdyktStatus !== "send_failed" ? r.werdyktNazwa : null;
  const uAllegro = r.statusAllegro ? ROZSTRZYGNIETE[r.statusAllegro] : undefined;
  const maWerdykt = Boolean(naszWerdykt) || Boolean(uAllegro);
  const termin = terminSlowem(r);
  const slowo = ostatnieSlowo(szczegol.czat ?? []);
  const klientCzeka = slowo?.autorRola === "BUYER";
  /* Status, którego nie tłumaczy werdykt ani kubełek, stoi surowy — tak samo
     jak nieznany powód. Pusty slot byłby gorszy od kodu: kod da się
     dopisać do słownika, pustego miejsca nikt nie zauważy. */
  const innyStatus = r.statusAllegro && r.statusAllegro !== "CLAIM_SUBMITTED" && !uAllegro
    ? r.statusAllegro : null;

  return <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-3">
    <div className="flex min-w-0 flex-[999_1_24rem] flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
        <span className="font-bold tabular-nums text-slate-900">{numer}</span>
        <Skopiuj tekst={numer} tytul="Kopiuj numer reklamacji" />
        {r.kupujacyLogin && <><Kropka /><LoginKlienta login={r.kupujacyLogin} className="text-slate-800" /></>}
        {powod && <><Kropka /><span>{powod}</span></>}
        <Kropka />
        <span>klient chce:{" "}
          <b className="text-slate-900">{oczekiwanie ?? "nie podał"}</b>
          {kwota && <>{" "}<b className="tabular-nums text-slate-900">{kwota}</b></>}
        </span>
      </p>
      <h2 className="text-naglowek font-bold text-slate-900">{r.ofertaNazwa ?? "Oferty nie pobrano"}</h2>
      {/* SYGNATURA MÓWI, SKĄD JEST. Symbol bywa wzięty z PARAGONU, a bywa
          z dzisiejszego mapowania oferty — to dwie różne rzeczy, gdy sprzedawca
          przepiął sygnaturę po wyczerpaniu dostawy. Bez tej adnotacji ekran
          kazałby ufać jednakowo obu. */}
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-slate-600">
        {towar.symbol
          ? <>
              <PrzyciskTowaru twId={towar.twId}>
                <span className="font-mono font-semibold text-slate-800">{towar.symbol}</span></PrzyciskTowaru>
              {towar.zrodlo && <><Kropka /><span>{NAPIS_ZRODLA[towar.zrodlo]}</span></>}
            </>
          /* Przy braku stoi ZDANIE serwera, nie kod powodu: `powod` jest
             kluczem dla liczników, a agent ma przeczytać, które ogniwo pękło. */
          : <span>{szczegol.kartoteka?.zrodlo ?? "bez kartoteki"}</span>}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
        {slowo && <span className={`inline-flex items-center gap-1.5 ${
          klientCzeka ? "font-semibold text-ranga-uwaga" : "text-slate-700"}`}>
          {klientCzeka && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />}
          Ostatnie słowo: {OSTATNIE_SLOWO[slowo.autorRola ?? ""]} · {czas(slowo.utworzonoAt)}</span>}
        {naszWerdykt && <span className="text-slate-700">Werdykt:{" "}
          <b className="text-slate-900">{naszWerdykt}</b></span>}
        {!naszWerdykt && uAllegro && <span className="text-slate-700">Werdykt:{" "}
          <b className="text-slate-900">{uAllegro}</b> w Centrum Sprzedaży</span>}
        {!maWerdykt && <span className="text-slate-700">Decyzja do:{" "}
          <b className={termin.pilny ? "text-ranga-zle" : "text-slate-900"}>{termin.napis}</b>
          {r.decyzjaDo && <span className="text-slate-600"> · {czas(r.decyzjaDo)}</span>}</span>}
        {r.zwrotWymagany !== null && <span className="text-slate-700">
          {r.zwrotWymagany ? "zwrot towaru wymagany" : "zwrot towaru niewymagany"}</span>}
        {innyStatus && <span className="text-slate-700">Allegro: <b>{innyStatus}</b></span>}
      </p>
    </div>
    {/* Kto prowadzi — CZYNNOŚĆ, więc stoi w głowicy przy decyzji „biorę to",
        a nie w kolumnie faktów. Własną sprawę da się odłożyć tym samym
        przyciskiem, bo serwer zdejmuje znacznik drugim kliknięciem. */}
    <div className="ml-auto flex min-w-0 flex-col items-end gap-1">
      <Prowadzi wWierszu prowadzi={r.prowadzi} trwa={trwa} onProwadze={onProwadze}
        jaProwadze={mojaSprawa(r.prowadziId, mojeId)} />
      {blad && <p className="text-xs text-red-700">{blad}</p>}
    </div>
  </div>;
}
