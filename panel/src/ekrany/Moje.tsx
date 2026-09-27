import React from "react";
import { MessageSquare, MessagesSquare, Scale, Briefcase, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useMojeSprawy } from "../api/rozmowy";
import type { MojaSprawa } from "../api/typy";
import { Blad, Karta, NaglowekSekcji, czas, termin } from "../ui";

/* ── Jedno „Moje" ponad kolejkami (S4 spoiwa, `docs/obsluga-klienta-calosc.md`)
   Sita „Moje" były trzy — w skrzynce, w reklamacjach i w dyskusjach — i każde
   trzeba było odwiedzić osobno. Sprawa z terminem w kolejce, do której agent
   akurat nie zaglądał, czekała aż ktoś tam zajrzy.

   TO JEST ODCZYT, NIE PIĄTA KOLEJKA. Nie ma tu ani jednego przycisku pracy:
   werdykt, kwota i odpowiedź zostają na ekranie właściwej kolejki, bo tam
   stoją ich bramki. Wspólny ekran roboczy nad kolejkami byłby nakładką ze
   wspólnym statusem — kształtem, który kosztował cztery tabele (0.140.0).

   ZWROTÓW TU NIE MA i to nie jest brak: właściciel zdjął ze zwrotu znacznik
   prowadzącego w 0.370.0, bo zwrot przechodzi przez biuro jako kolejka
   decyzji, a nie jako czyjaś sprawa.

   SPRAWA KLIENTA TU JEST (S6, 0.535.0) i dalej bez przycisku. Wiersz
   prowadzi do źródła najnowszego zdarzenia albo do profilu klienta, bo tam
   stoją krok i zakończenie. Listę scala serwer (`mojaLista`), więc kolejność
   — obudzone, potem terminy, na końcu kroki czekające na swój dzień — jest
   jedna dla każdego, kto ją czyta.                                          */

const KOLEJKI = {
  rozmowa: { nazwa: "pytanie", ikona: MessageSquare, sciezka: "/obsluga/skrzynka" },
  dyskusja: { nazwa: "dyskusja", ikona: MessagesSquare, sciezka: "/obsluga/dyskusje" },
  reklamacja: { nazwa: "reklamacja", ikona: Scale, sciezka: "/obsluga/reklamacje" },
  klient: { nazwa: "klient", ikona: UserRound, sciezka: "/obsluga/klient" },
} as const;

/* Profil idzie po LOGINIE, nie po numerze sprawy — trasa profilu zna tylko
   login. Serwer podaje `cel` zawsze; zapas na wypadek starszego serwera. */
const dokad = (s: MojaSprawa, sciezka: string) => s.kolejka !== "klient"
  ? `${sciezka}/${s.id}`
  : s.cel ?? `${sciezka}/${encodeURIComponent(s.login ?? "")}`;

/* Termin z nagłówka liczy sprawę klienta dopiero, gdy jej dzień nadszedł.
   Krok „czekamy do przyszłego wtorku" ma datę, ale nie jest pracą na dziś —
   licznik, który go liczy, rośnie z każdą sprawą i przestaje cokolwiek mówić. */
const zTerminemNaDzis = (s: MojaSprawa) =>
  s.kolejka === "klient" ? Boolean(s.dzis || s.poTerminie) : s.terminDo !== null;

/* ── SEKCJA „DO ZROBIENIA", NIE OSOBNY EKRAN (23 września 2026) ────────────
   „Do decyzji", „Moje" i „Wzmianki" odpowiadały na jedno pytanie — co teraz
   zrobić — i trzeba było obejść trzy zakładki, żeby je zadać. Sekcja stoi
   dziś na ekranie startowym razem z pozostałymi dwiema. Adres `/obsluga/moje`
   przekierowuje tam, więc zakładka zapamiętana w przeglądarce nie gubi się. */
export function Moje() {
  const dane = useMojeSprawy();
  /* `lista` niesie też sprawy klientów; starszy serwer daje samo `sprawy`.
     Wiersz rodzaju, którego ta karta nie zna, SCHODZI z listy, zamiast
     wywrócić ekran: panel nie ma granicy błędu, a serwer aktualizuje się
     w nocy pod otwartą kartą. Tak wywróciłaby się karta sprzed 0.535.0. */
  const sprawy = (dane.data?.lista ?? dane.data?.sprawy ?? []).filter((s) => Object.hasOwn(KOLEJKI, s.kolejka));
  const zTerminem = sprawy.filter(zTerminemNaDzis).length;

  return <Karta className="overflow-hidden p-0" aria-label="Moje sprawy" role="region">
    {/* Nagłówek jak w dwóch sąsiednich sekcjach (0.524.0): `NaglowekSekcji`
        i licznik po kropce. Powód przy `DoDecyzji`. „Wczytuję…" zeszło
        z nagłówka do treści, tam gdzie stoi w sekcji decyzji. */}
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
      <NaglowekSekcji jako="h3" ikona={<Briefcase size={14} />}>
        Moje sprawy{dane.data ? ` · ${sprawy.length}` : ""}
        {zTerminem > 0 && ` · ${zTerminem} z terminem`}</NaglowekSekcji>
    </div>

    {dane.error && <Blad>{(dane.error as Error).message}</Blad>}

    {/* Pusta sekcja to JEDNA linijka, nie ilustracja na pół ekranu — na
        wspólnym ekranie stoi nad listą decyzji i nie ma jej zasłaniać. */}
    {dane.isLoading
      ? <p className="px-4 py-2 text-sm text-slate-500">Wczytuję…</p>
      : sprawy.length === 0
      ? <p className="px-4 py-2 text-sm text-slate-500">Nic nie prowadzisz. Weź sprawę z kolejki.</p>
      : <ul>
          {sprawy.map((s) => {
            const { nazwa, ikona: Ikona, sciezka } = KOLEJKI[s.kolejka];
            return <li key={`${s.kolejka}-${s.id}`} className="border-t first:border-t-0">
              <Link to={dokad(s, sciezka)}
                className="flex flex-wrap items-baseline gap-2 px-4 py-2 text-sm hover:bg-slate-50">
                <Ikona size={14} className="shrink-0 text-slate-400" />
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-podpis font-bold text-slate-700">
                  {nazwa}</span>
                <span className="min-w-0 flex-1 truncate">{s.opis}</span>
                {/* Termin, gdy jest, stoi po prawej i jest JEDYNYM sygnałem
                    na wierszu — kolor zapalany zawsze uczy go ignorować. */}
                {s.kolejka === "klient"
                  ? <StanKroku s={s} />
                  : s.terminDo
                  ? <span className="shrink-0 font-semibold text-ranga-zle">
                      termin {czas(s.terminDo)}</span>
                  : <span className="shrink-0 text-xs text-slate-500">
                      ostatni ruch {czas(s.at)}</span>}
              </Link>
            </li>;
          })}
        </ul>}
  </Karta>;
}

/* Prawa strona wiersza sprawy klienta — JEDNO zdanie, nie trzy. Obudzona
   mówi, CO klient zrobił, i nic więcej: sprawa zakończona też bywa obudzona,
   a jej stary „po terminie" byłby na czerwono nieprawdą. Czerwień wyłącznie
   po terminie; „dziś" i „czeka do" to informacja, nie alarm.

   DOSYŁKA (0.536.0) ZASTĘPUJE „dziś” i „czeka do”, a nie dokleja się do
   opisu. Opis jest ucięty, więc dopisek znikałby właśnie przy długim kroku.
   Sprawa z dosyłką czeka na paczkę, a nie na datę. Samo „dziś”
   przy dosyłce bez numeru nie mówiłoby, co zrobić. Pogrubienie niesie to,
   co niosło „dziś”: serwer postawił wiersz na dziś. */
function StanKroku({ s }: { s: MojaSprawa }) {
  if (s.nowe) return <span className="shrink-0 font-semibold text-slate-900">{s.nowe}</span>;
  if (s.poTerminie) {
    return <span className="shrink-0 font-semibold text-ranga-zle">
      po terminie{s.terminDo && ` · ${termin(s.terminDo)}`}</span>;
  }
  if (s.dosylka) {
    return <span className={`shrink-0 ${s.dzis ? "font-semibold text-slate-900" : "text-xs text-slate-600"}`}>
      {s.dosylka}</span>;
  }
  if (s.dzis) return <span className="shrink-0 font-semibold text-slate-900">dziś</span>;
  if (s.czeka && s.terminDo) {
    return <span className="shrink-0 text-xs text-slate-500">czeka do {termin(s.terminDo)}</span>;
  }
  return <span className="shrink-0 text-xs text-slate-500">ostatni ruch {czas(s.at)}</span>;
}
