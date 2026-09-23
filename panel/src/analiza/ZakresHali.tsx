import React from "react";
import type { AnalizaAudytu, Metryki } from "../api/wglad";
import { odmien } from "../ui";
import { Liczba, PasekUdzialu, Slupki } from "../ui/wykres";
import { dzienSkrot, liczbaPl, zdanieOSzczycie } from "./liczby";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Zakres PRACA HALI (z `biuro.html`, w panelu od 0.440.0) ─────────────
   Dawny zakres „Ślad audytowy" — nazwa mówiła, SKĄD są dane, a nie o CZYM.
   Biuro pyta tu o pracę hali: ile, kiedy, czego szukano, co się psuje
   w kolektorach i kto ile zrobił.

   METRYKI PRZYSZŁY TU ZE STANU SYSTEMU. W biurze stały w NADZORZE z własnym
   oknem 7/30/90 dni, osobnym od okna analizy — dwa przełączniki tego samego
   pytania o dwie karty od siebie (dekalog pkt 5). Etykiety do przedruku
   i kartoteki bez kodu mówią o pracy hali w oknie, nie o stanie serwera
   TERAZ, więc mieszkają tu i słuchają jednego okna. */

export function ZakresHali({ a, m }: { a: AnalizaAudytu; m: Metryki | undefined }) {
  const r = a.rytm;
  return <>
    <KartaWgladu tytul="Praca hali w oknie">
      <div className="flex flex-wrap gap-8">
        <Liczba ile={a.dni.reduce((s, d) => s + d.pozycje, 0)} etykieta={`pozycji w oknie ${a.days} dni`} />
        <Liczba ile={r.dostawZamknietych} etykieta="dostaw rozłożonych" />
        <Liczba ile={r.medianaMinutDostawy != null ? `${r.medianaMinutDostawy} min` : "—"} etykieta="mediana czasu dostawy" />
        <Liczba ile={r.problemyOtwarte} etykieta="problemów czeka na biuro"
          ton={r.problemyOtwarte > 0 ? "text-ranga-zle" : ""} />
      </div>
      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold">Operacje per dzień</h3>
          <p className="mb-2 text-xs text-slate-600">Wykonane pozycje — dni według zegara magazynu.</p>
          <Slupki opis={`Wykonane pozycje per dzień, okno ${a.days} dni`}
            co={a.days > 30 ? 14 : a.days > 7 ? 7 : 1}
            dane={a.dni.map((d) => ({ ile: d.pozycje, podpis: dzienSkrot(d.data), tytul: d.data }))} />
          {a.szczyt && <p className="mt-3 text-sm text-slate-600">{zdanieOSzczycie(a.szczyt.pozycje,
            a.szczyt.medianaPozostalych, dzienSkrot(a.szczyt.data),
            odmien(a.szczyt.pozycje, "pozycja", "pozycje", "pozycji"))}</p>}
        </div>
        <div>
          <h3 className="text-sm font-bold">Rozkład po godzinach</h3>
          <p className="mb-2 text-xs text-slate-600">O której naprawdę jest szczyt.</p>
          <Slupki opis="Operacje według godziny doby" co={3}
            dane={a.godziny.map((ile, g) => ({ ile, podpis: String(g), tytul: `godzina ${g}:00` }))} />
        </div>
      </div>
    </KartaWgladu>

    {m && <KartaWgladu tytul="Metryki · liczby, które mówią, co zrobić"
      opis="Cele stoją obok liczb, bo liczba bez celu nie mówi, czy jest źle. p95 powyżej 300 ms znaczy, że ludzie zaczynają skanować podwójnie.">
      <div className="flex flex-wrap gap-8">
        <Liczba ile={liczbaPl(m.dotknieciaNaPozycje)} etykieta="dotknięć na pozycję · cel < 0,3"
          ton={m.dotknieciaNaPozycje != null && m.dotknieciaNaPozycje >= 0.3 ? "text-ranga-zle" : ""} />
        <Liczba ile={m.p95OdpowiedziMs != null ? `${m.p95OdpowiedziMs} ms` : "—"} etykieta="p95 skanu na ekranie głównym · cel < 150 ms"
          ton={m.p95OdpowiedziMs != null && m.p95OdpowiedziMs > 300 ? "text-ranga-zle" : ""} />
        <Liczba ile={m.zdarzen} etykieta={`zdarzeń w oknie ${m.days} dni`} />
      </div>
      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold">Etykiety do przedruku</h3>
          <p className="mb-2 text-xs text-slate-600">Regały, których kod trzeba wpisywać z ręki.</p>
          <Tabela naglowki={["Regał", "Ręcznie", "Udział"]} pusto="Wszystkie etykiety czytelne.">
            {m.etykietyDoPrzedruku.map((e) => <tr key={e.code}>
              <Td className="font-semibold">{e.code}</Td>
              <Td className="tabular-nums">{e.reczne} z {e.razem}</Td>
              <Td className="tabular-nums">{Math.round(e.udzial * 100)}%</Td>
            </tr>)}
          </Tabela>
        </div>
        <div>
          <h3 className="text-sm font-bold">Kartoteki bez czytelnego kodu</h3>
          <p className="mb-2 text-xs text-slate-600">Wpisywane zamiast skanowane — kod do naprawy.</p>
          <Tabela naglowki={["Kod", "Wpisano ręcznie"]} pusto="Brak kartotek wpisywanych z ręki.">
            {m.towaryBezCzytelnegoKodu.map((t) => <tr key={t.code}>
              <Td className="font-semibold">{t.code}</Td>
              <Td className="tabular-nums">{t.reczne}×</Td>
            </tr>)}
          </Tabela>
        </div>
      </div>
    </KartaWgladu>}

    {/* WYDAJNOŚĆ PER OSOBA — tylko administrator (0.431.0, decyzja
        właściciela). Rozstrzyga SERWER: dla roli biuro raportu nie liczy
        i przysyła `null`, więc karta znika, zamiast stać pusta i wyglądać na
        brak pracy w oknie. Rola w przeglądarce nie decyduje tu o niczym —
        schowanie danych, które już przyszły, nie byłoby ochroną. */}
    {a.wydajnosc && <KartaWgladu tytul="Wydajność per osoba"
      opis={<>{a.wydajnosc.podstawaPrawna} Zgłoszone problemy to osobna kolumna i <b>nie są miarą błędu</b> —
        zgłoszenie wyjątku jest pracą wykonaną dobrze, nie wpadką.</>}>
      <Tabela naglowki={["Osoba", "Pozycje", "Czas aktywny", "Tempo/h", "Zgłoszone problemy"]}
        pusto="Brak pracy w tym oknie.">
        {a.wydajnosc.wiersze.map((o) => <tr key={`${o.userId}-${o.osoba}`}>
          <Td className="font-semibold">{o.osoba}</Td>
          <Td className="tabular-nums">{o.pozycje}</Td>
          <Td className="tabular-nums">{Math.round(o.minutyAktywne)} min</Td>
          {/* Tempo z cienkiej próbki jest liczbą, która krzywdzi — stąd
              plakietka zamiast wartości poniżej progu wiarygodności. */}
          <Td>{o.wiarygodne ? o.tempo
            : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">mało danych</span>}</Td>
          <Td className="tabular-nums">{o.zgloszoneProblemy}</Td>
        </tr>)}
      </Tabela>
      {a.wydajnosc.nieprzypisanychZdarzen > 0 && <p className="mt-2 text-sm text-slate-600">
        + {a.wydajnosc.nieprzypisanychZdarzen} zdarzeń bez konta — nie doklejamy ich nikomu.</p>}
    </KartaWgladu>}

    <div className="grid gap-4 xl:grid-cols-2">
      <KartaWgladu tytul="Najczęściej szukane"><Szukania lista={a.szukania.top} pusto="Nikt nic nie szukał." /></KartaWgladu>
      <KartaWgladu tytul="Szukane bez wyniku"
        opis="Towary, których ludzie szukają, a kartoteka ich nie zna — najtańsza lista braków.">
        <Szukania lista={a.szukania.bezWynikow} pusto="Wszystko, czego szukano, znajdowało się." /></KartaWgladu>
    </div>

    <KartaWgladu tytul="Urządzenia" opis="Upadki, baterie i odrzucone operacje — per kolektor, nie per osoba.">
      <Tabela naglowki={["Urządzenie", "Upadki", "Niskie baterie", "Odrzucone", "Zdarzeń"]}
        pusto="Brak zdarzeń z urządzeń w tym oknie.">
        {a.urzadzenia.map((u) => <tr key={u.device}>
          <Td className="font-semibold">{u.device}</Td>
          <Td><Zero n={u.upadki} /></Td>
          <Td className="tabular-nums">{u.niskieBaterie}</Td>
          <Td><Zero n={u.odrzucone} /></Td>
          <Td className="tabular-nums">{u.zdarzen}</Td>
        </tr>)}
      </Tabela>
    </KartaWgladu>
  </>;
}

function Szukania({ lista, pusto }: { lista: Array<{ q: string; ile: number }>; pusto: string }) {
  const max = Math.max(...lista.map((t) => t.ile), 0);
  return <Tabela naglowki={["Zapytanie", "Razy"]} pusto={pusto}>
    {lista.map((t) => <tr key={t.q}>
      <Td className="font-semibold">{t.q}</Td>
      <Td><PasekUdzialu ile={t.ile} max={max} /></Td>
    </tr>)}
  </Tabela>;
}

/** Upadek i odrzucenie są zdarzeniem do sprawdzenia — niezerowe dostają czerwień. */
const Zero = ({ n }: { n: number }) => n
  ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-ranga-zle">{n}</span>
  : <span className="tabular-nums">0</span>;
