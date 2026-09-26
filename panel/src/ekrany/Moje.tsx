import React from "react";
import { MessageSquare, MessagesSquare, Scale, Briefcase } from "lucide-react";
import { Link } from "react-router-dom";
import { useMojeSprawy } from "../api/rozmowy";
import { Blad, Karta, NaglowekSekcji, czas } from "../ui";

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
   decyzji, a nie jako czyjaś sprawa.                                        */

const KOLEJKI = {
  rozmowa: { nazwa: "pytanie", ikona: MessageSquare, sciezka: "/obsluga/skrzynka" },
  dyskusja: { nazwa: "dyskusja", ikona: MessagesSquare, sciezka: "/obsluga/dyskusje" },
  reklamacja: { nazwa: "reklamacja", ikona: Scale, sciezka: "/obsluga/reklamacje" },
} as const;

/* ── SEKCJA „DO ZROBIENIA", NIE OSOBNY EKRAN (23 września 2026) ────────────
   „Do decyzji", „Moje" i „Wzmianki" odpowiadały na jedno pytanie — co teraz
   zrobić — i trzeba było obejść trzy zakładki, żeby je zadać. Sekcja stoi
   dziś na ekranie startowym razem z pozostałymi dwiema. Adres `/obsluga/moje`
   przekierowuje tam, więc zakładka zapamiętana w przeglądarce nie gubi się. */
export function Moje() {
  const dane = useMojeSprawy();
  const sprawy = dane.data?.sprawy ?? [];
  const zTerminem = sprawy.filter((s) => s.terminDo !== null).length;

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
              <Link to={`${sciezka}/${s.id}`}
                className="flex flex-wrap items-baseline gap-2 px-4 py-2 text-sm hover:bg-slate-50">
                <Ikona size={14} className="shrink-0 text-slate-400" />
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-podpis font-bold text-slate-700">
                  {nazwa}</span>
                <span className="min-w-0 flex-1 truncate">{s.opis}</span>
                {/* Termin, gdy jest, stoi po prawej i jest JEDYNYM sygnałem
                    na wierszu — kolor zapalany zawsze uczy go ignorować. */}
                {s.terminDo
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
