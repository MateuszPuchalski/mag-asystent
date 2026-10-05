import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { ExternalLink, UserRound } from "lucide-react";
import type { SzczegolReklamacji } from "../api/typy";
import { zlote } from "../api/zwroty";
import { czas, ile, LoginKlienta, Skopiuj } from "../ui";
import { Prowadzi } from "../sprawy/Prowadzi";
import { mojaSprawa } from "../sprawy/Moje";
import { PrzyciskHistorii } from "../sprawy/HistoriaKlienta";
import { PrzyciskTowaru } from "../towar/Szuflada";
import { OCZEKIWANIA, POWODY } from "./Kolejka";
import { PRAWO } from "./statusy";
import { coSieDzieje, ileReklamacji, tytulStatusu, type Czlon, type Ton } from "./etap";

/* ── Głowica sprawy: kto, co się dzieje, o co chodzi ─────────────────────────
   Jeden pas na całą szerokość obszaru sprawy, nad rozmową, dowodami
   i faktami. Czyta się go z góry na dół w trzech warstwach.

   KTO. Uwaga właściciela: „Client powinien być bardziej widoczny". Login
   stoi pierwszy, w 17 px, bo to klucz klienta w całej drodze, a nie podpis
   przy numerze. Obok profil, historia i liczba jego innych reklamacji, a po
   prawej, kto u nas prowadzi sprawę.

   CO SIĘ DZIEJE. Dwa zdania z `etap.ts` zamiast czterech etykiet. Etap
   i termin, potem rozmowa i towar. Surowy status Allegro zostaje pod
   kursorem zdania A, bo na ekranie stoją słowa, nie kody.

   O CO CHODZI. Pod kreską towar z symbolem i żądanie klienta. Nazwa towaru
   schodzi do 14 px, bo 17 px należy teraz do klienta, a tożsamość towaru
   niesie też zdjęcie w kolumnie dowodów.

   Numer reklamacji i data zgłoszenia stoją w prawej szczelinie pod
   „Prowadzi”. To ich jedyny dom: kolumna faktów ich nie powtarza, bo
   uwaga właściciela brzmiała „informacje powtarzają się”.

   ZDJĘĆ TU NIE MA. Obraz oferty i kartoteki stoi w kolumnie zdjęć pod
   „Wysłaliśmy", obok tego, co przysłał klient — tam się je porównuje.
   Cena też nie: ile kosztowało, mówią kostki faktów po prawej. */

/* ── JEDNA KARTOTEKA NA CAŁĄ SPRAWĘ ──────────────────────────────────────────
   Symbol w głowicy z przekrojem towaru, kafel pod „Wysłaliśmy", fakty
   „Mamy" i „nasz zakup" oraz kartoteka cen pytają o TĘ SAMĄ rzecz: która to
   kartoteka u nas. Każdy element pyta tej funkcji, bo osobne pytania się
   rozjeżdżają. Symbol z dopasowania po SKU obok „sprawa bez kartoteki" to
   dwie sprzeczne odpowiedzi na jednym ekranie.

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

/* Rola członu zdania na barwę i wagę — w jednym miejscu, żeby czysta funkcja
   w `etap.ts` nie znała Tailwinda. Bursztyn („czeka", „uwaga") znaczy
   wyłącznie „uwaga”; czerwień tylko błąd albo termin od trzech dni w dół. */
const KLASA_TONU: Record<Ton, string> = {
  glowny: "font-semibold text-slate-900",
  zle: "font-semibold text-ranga-zle",
  uwaga: "font-semibold text-ranga-uwaga",
  ok: "font-semibold text-ranga-ok",
  spokojny: "font-semibold text-slate-700",
  tekst: "",
  termin: "font-bold text-slate-900",
  terminPilny: "font-bold text-ranga-zle",
  data: "tabular-nums text-slate-600",
  cichy: "text-slate-600",
  czeka: "font-semibold text-ranga-uwaga",
};

/** Człony zdania jeden za drugim; klient czekający na nas dostaje kropkę przed swoim zdaniem. */
const Czlony = ({ czlony }: { czlony: Czlon[] }) => <>
  {czlony.map((c, i) => <span key={i} className={KLASA_TONU[c.ton] || undefined}>
    {c.ton === "czeka" &&
      <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500" />}
    {c.tekst}</span>)}
</>;

/** Kropka między członami — dla oka, nie dla czytnika ekranu. */
const Kropka = () => <span aria-hidden="true" className="text-slate-500">·</span>;

export function Glowica({ szczegol, mojeId = null, trwa, blad = "", onProwadze, onPokazZakup }: {
  szczegol: SzczegolReklamacji;
  /** Konto patrzącego — po nim „Ty" i „Odłóż sprawę" zamiast cudzego imienia. */
  mojeId?: number | null;
  trwa: boolean;
  blad?: string;
  onProwadze: () => void;
  /* Przewinięcie do zwijki „Ten zakup u nas" i jej otwarcie. Opcjonalne tym
     samym wzorcem co reszta: bez procedury wskaźnik zostaje zdaniem, a nie
     martwym przyciskiem. */
  onPokazZakup?: () => void;
}) {
  const r = szczegol.reklamacja;
  const numer = r.numer ?? r.externalId;
  const login = r.kupujacyLogin;
  const powod = r.powodTyp ? (POWODY[r.powodTyp] ?? r.powodTyp) : null;
  const oczekiwanie = r.oczekiwanie ? (OCZEKIWANIA[r.oczekiwanie] ?? r.oczekiwanie) : null;
  const kwota = r.oczekiwanaKwotaGrosze !== null ? zlote(r.oczekiwanaKwotaGrosze, r.waluta) : null;
  const towar = kartotekaKolumny(szczegol);
  const etap = coSieDzieje(szczegol);
  /* Czytamy ostrożnie: starszy serwer historii nie zna, a jej brak ma znaczyć
     „nie wiemy", nie wywracać głowicy. `null` serwer daje też przy zerze,
     więc ekran nigdy nie mówi „pierwsza reklamacja". */
  const historiaKlienta = szczegol.historia?.klient ?? null;
  const otwarteRodzenstwo = (szczegol.sprawy ?? []).filter((s) => s.otwarta).length;
  const rodzenstwo = otwarteRodzenstwo > 0
    ? `jeszcze ${ile(otwarteRodzenstwo, "otwarta sprawa", "otwarte sprawy", "otwartych spraw")} tego zakupu`
    : null;

  return <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-3">
    <div className="flex min-w-0 flex-[999_1_24rem] flex-col gap-1">
      {/* ── KTO ─────────────────────────────────────────────────────────────
          Login KOPIUJE po kliknięciu, więc profil i historia są osobnymi
          celami po 24 px z odstępem 8 px (WCAG 2.5.8). W nagłówku stoi sam
          login: szuflada historii nie może wylądować w środku `h2`. */}
      {login
        ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-700">
            <h2 className="flex min-w-0 items-center gap-1.5">
              <UserRound size={16} aria-hidden="true" className="shrink-0 text-slate-600" />
              <LoginKlienta login={login} className="font-mono text-naglowek font-bold text-slate-900" />
            </h2>
            <Kropka />
            {/* Profil domyka wiązanie klienta w obie strony: profil prowadzi
                do reklamacji, a reklamacja do profilu. Słowa i kolejność jak
                w nagłówku zwrotu, żeby ręka znała je z tamtego ekranu. */}
            <RouterLink to={`/obsluga/klient/${encodeURIComponent(login)}`}
              title="Profil klienta — zakupy, zwroty, reklamacje i rozmowy"
              className="inline-flex min-h-6 items-center gap-1 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
              <UserRound size={12} aria-hidden="true" />profil</RouterLink>
            <PrzyciskHistorii rodzaj="sprawa" id={r.id} />
            {historiaKlienta && <>
              <Kropka />
              <span>jeszcze {ileReklamacji(historiaKlienta, " u nas")}</span>
            </>}
            {rodzenstwo && <>
              <Kropka />
              {/* Inna otwarta sprawa tego zakupu to klient, który czeka też
                  gdzie indziej. Wskaźnik tylko przewija do listy i ją otwiera,
                  niczego nie zapisuje. */}
              {onPokazZakup
                ? <button type="button" onClick={onPokazZakup}
                    className="min-h-6 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
                    {rodzenstwo} <span aria-hidden="true">↓</span></button>
                : <span className="font-semibold">{rodzenstwo}</span>}
            </>}
          </div>
        /* Brak loginu mówi o sobie: pusty slot czytałby się jak awaria, a to
           Allegro go nie podało. Bez loginu nie ma czyjego profilu ani historii. */
        : <h2 className="text-tresc text-slate-600">kupujący: Allegro nie podało loginu</h2>}

      {/* ── CO SIĘ DZIEJE ─────────────────────────────────────────────────── */}
      <p className="mt-1 text-tresc text-slate-700" title={tytulStatusu(etap.kodAllegro)}>
        <Czlony czlony={etap.a} /></p>
      {etap.b.length > 0 && <p className="text-sm text-slate-700"><Czlony czlony={etap.b} /></p>}
      <hr className="my-0.5 border-slate-200" />

      {/* ── O CO CHODZI ─────────────────────────────────────────────────────
          SYGNATURA MÓWI, SKĄD JEST. Symbol bywa wzięty z PARAGONU, a bywa
          z dzisiejszego mapowania oferty — to dwie różne rzeczy, gdy sprzedawca
          przepiął sygnaturę po wyczerpaniu dostawy. Bez tej adnotacji ekran
          kazałby ufać jednakowo obu. */}
      <p className="text-sm">
        {r.ofertaNazwa
          ? <span className="font-semibold text-slate-900">{r.ofertaNazwa}</span>
          : <span className="text-slate-600">Oferty nie pobrano</span>}
        <span className="ml-2 inline-flex flex-wrap items-baseline gap-x-1.5 text-xs text-slate-600">
          {towar.symbol
            ? <>
                <PrzyciskTowaru twId={towar.twId}>
                  <span className="font-mono font-semibold text-slate-800">{towar.symbol}</span></PrzyciskTowaru>
                {towar.zrodlo && <><Kropka /><span>{NAPIS_ZRODLA[towar.zrodlo]}</span></>}
              </>
            /* Przy braku stoi ZDANIE serwera, nie kod powodu: `powod` jest
               kluczem dla liczników, a agent ma przeczytać, które ogniwo pękło. */
            : <span>{szczegol.kartoteka?.zrodlo ?? "bez kartoteki"}</span>}
        </span>
      </p>
      <p className="text-sm text-slate-700">
        <span className="text-slate-600">Chce:</span>{" "}
        <b className="font-bold text-slate-900">{oczekiwanie ?? "nie podał"}</b>
        {kwota && <>{" "}<b className="font-bold tabular-nums text-slate-900">{kwota}</b></>}
        {powod && <>{" "}<Kropka />{" "}<span>{powod}</span></>}
        {" "}<Kropka />{" "}
        <span>{r.prawo ? (PRAWO[r.prawo] ?? "tytuł nieznany") : "tytuł nieznany"}</span>
      </p>
    </div>

    {/* ── PRAWA SZCZELINA: KTO PROWADZI, NUMER I ZGŁOSZENIE ────────────────
        Wzięcie sprawy jest CZYNNOŚCIĄ, więc stoi w głowicy, a nie w kolumnie
        faktów. Własną sprawę da się odłożyć tym samym przyciskiem, bo serwer
        zdejmuje znacznik drugim kliknięciem. Numer i data zgłoszenia stoją
        pod spodem: to fakty do skopiowania, nie do decyzji. */}
    <div className="ml-auto flex min-w-0 flex-col items-end gap-1">
      <Prowadzi wWierszu prowadzi={r.prowadzi} trwa={trwa} onProwadze={onProwadze}
        jaProwadze={mojaSprawa(r.prowadziId, mojeId)} />
      {blad && <p className="text-xs text-red-700">{blad}</p>}
      <p className="flex items-center gap-1 text-xs text-slate-600">
        reklamacja <b className="font-bold tabular-nums text-slate-900">{numer}</b>
        {/* Przycisk kopiowania nie niesie numeru w nazwie: kolejka szuka
            wierszy po numerze, a drugi przycisk z nim byłby drugim wierszem. */}
        <Skopiuj tekst={numer} tytul="Kopiuj numer reklamacji" />
        {r.link && <a href={r.link} target="_blank" rel="noopener noreferrer"
          aria-label="Reklamacja w Allegro" title="Reklamacja w Allegro"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <ExternalLink size={12} aria-hidden="true" /></a>}
      </p>
      <p className="text-xs text-slate-600">zgłoszona {czas(r.otwartoAt)}</p>
    </div>
  </div>;
}
