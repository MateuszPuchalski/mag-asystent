import React, { useEffect, useRef } from "react";
import { AlertTriangle, PackageX, Ban, CircleHelp, BanknoteArrowDown, Copy } from "lucide-react";
import type { Kubelek, Sygnal, Zwrot } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Zdjecie } from "../towar/Zdjecie";
import { Pusto, ile, dniSlowo } from "../ui";

/* ── Kolejka zwrotów ─────────────────────────────────────────────────────────
   Wiersz ma się czytać W BIEGU, więc niesie SIEDEM rzeczy i ani jednej
   więcej: numer, klienta zamówienia, towar, sztuki, dni do terminu, kwotę
   proponowaną i sygnał. Wszystko, co trzeba doczytać, siedzi w kolumnie
   dowodów po prawej — a nie tutaj.

   Kolejność liczy SERWER (najkrótszy termin na górze) i panel jej nie
   zmienia. Dwie reguły sortowania rozjechałyby się przy pierwszej poprawce
   jednej z nich, a objawem byłby ekran pokazujący inną pilność niż liczniki. */

export const KUBELKI: Array<{ id: Kubelek; etykieta: string; pytanie: string }> = [
  { id: "decyzja", etykieta: "Do decyzji", pytanie: "Przyjąć czy odrzucić?" },
  { id: "ocena", etykieta: "Do oceny", pytanie: "Co z towarem?" },
  { id: "zwrot", etykieta: "Do zwrotu", pytanie: "Ile oddać?" },
  /* Numer się WPISUJE, nie zleca (0.484.7) — przycisku „zleć" nie ma. */
  { id: "korekta", etykieta: "Do korekty", pytanie: "Jest numer korekty?" },
  { id: "odrzucony", etykieta: "Odrzucone", pytanie: "Tylko wgląd." },
  { id: "zamkniety", etykieta: "Zamknięte", pytanie: "Tylko wgląd." },
];

/* Etykieta stoi W MAPIE, nie w łańcuchu `?:` przy renderze (0.209.0). Łańcuch
   znał trzy sygnały i milcząco podpisywał każdy czwarty ostatnią gałęzią —
   czyli nowy sygnał kłamałby na ekranie, zamiast nie przejść kompilacji. */
export const SYGNALY: Record<Sygnal,
  { tytul: string; krotko: string; ikona: React.ReactNode; klasa: string }> = {
  termin: { tytul: "Termin ustawowy blisko albo minął", krotko: "termin",
    klasa: "bg-red-100 text-ranga-zle", ikona: <AlertTriangle size={13} /> },
  brak_dowodu: { tytul: "Klient nie nadał jeszcze paczki, a termin biegnie",
    krotko: "nie nadana",
    klasa: "bg-amber-100 text-ranga-uwaga", ikona: <PackageX size={13} /> },
  odrzucony_w_allegro: { tytul: "Ktoś rozstrzygnął to już w panelu Allegro",
    krotko: "w Allegro",
    klasa: "bg-slate-200 text-ranga-nic", ikona: <Ban size={13} /> },
  /* Przelew wyszedł od nas, a Allegro go nie potwierdziło — trzeba zajrzeć
     w panel Allegro, zanim ktoś zleci drugi. */
  pieniadze_niepotwierdzone: {
    tytul: "Zleciliśmy przelew, a Allegro go nie potwierdziło",
    krotko: "przelew?", klasa: "bg-red-100 text-ranga-zle",
    ikona: <CircleHelp size={13} /> },
  /* Odwrotnie: pieniądze poszły poza tym panelem, a wiersz nadal prosi
     o kwotę, którą klient już dostał. */
  pieniadze_poza_panelem: {
    tytul: "Allegro mówi, że pieniądze już oddano — u nas nie ma po tym śladu",
    krotko: "już oddane", klasa: "bg-amber-100 text-ranga-uwaga",
    ikona: <BanknoteArrowDown size={13} /> },
  /* Kwotę ustalono, a pozycje zmieniły się po niej: synchronizator nadpisuje
     ilość i cenę przy każdym takcie. Czerwony, bo to pieniądze w złej
     wysokości, a nie praca do zrobienia kiedyś. */
  kwota_nieaktualna: {
    /* Podpowiedź KOŃCZY SIĘ RUCHEM (audyt, 15 września 2026). Sygnał mówił,
       co jest nie tak, i milkł — a naprawa to jedno kliknięcie w kubełku
       DO ZWROTU. */
    /* Przy korekcie kwoty nie poprawi się wprost (0.484.7): `cofnijKwote`
       odmawia, dopóki korekta stoi. Podpowiedź nazywa oba kroki. */
    tytul: "Kwota nie zgadza się z pozycjami — zmieniły się po wycenie. Popraw kwotę; przy korekcie najpierw ją cofnij (R)",
    krotko: "kwota?", klasa: "bg-red-100 text-ranga-zle",
    ikona: <CircleHelp size={13} /> },
  /* Wróciło mniej, niż klient zgłosił. Bursztyn, nie czerwień: to nie jest
     usterka, tylko fakt, który biuro już zapisało — a wypłata się z nim
     zgadza. Kolor mówi „przeczytaj przy reklamacji", nie „napraw teraz". */
  /* Pobranie czeka na przelew (0.269.0). Bursztyn, nie czerwień: to praca do
     zrobienia, nie usterka — Allegro tych pieniędzy nie trzymało, więc nikt
     ich nie odda za nas. Świeci także na zwrocie zamkniętym, bo przelew idzie
     zwykle PO korekcie. */
  przelew_czeka: {
    tytul: "Pobranie — pieniądze oddaje się przelewem. Zapisz go w sekcji Pieniądze",
    krotko: "przelew?", klasa: "bg-amber-100 text-ranga-uwaga",
    ikona: <BanknoteArrowDown size={13} /> },
  /* Drugi zwrot tego zamówienia z innego źródła (0.493.0). Czerwień, bo to
     pieniądze, które mogą wyjść dwa razy — nie praca na kiedyś. */
  /* Klient nie odesłał paczki w 14 dni (@wydanie). Czerwień, bo w DO DECYZJI
     czeka odmowa, a zwrot bez niej wygląda jak zwrot w drodze. */
  nie_odeslany: {
    tytul: "Klient zgłosił zwrot, ale przez 14 dni nie nadał paczki — pieniądze się nie należą. Odmów (N)",
    krotko: "nie odesłał", klasa: "bg-red-100 text-ranga-zle",
    ikona: <PackageX size={13} /> },
  drugi_zwrot: {
    tytul: "To zamówienie ma też drugi zwrot — paczkę nieodebraną albo zwrot z Allegro. Pieniądze oddaje się raz",
    krotko: "2 zwroty", klasa: "bg-red-100 text-ranga-zle",
    ikona: <Copy size={13} /> },
  rozjazd_ilosci: {
    tytul: "Wróciło mniej sztuk, niż klient zgłosił",
    krotko: "mniej szt.", klasa: "bg-amber-100 text-ranga-uwaga",
    ikona: <PackageX size={13} /> },
};

/* `dniSlowo` mieszka w `ui/` od audytu z 15 września 2026 — stało w trzech
   kolejkach przepisane znak w znak. Re-eksport zostaje, bo wołają je stąd
   sąsiednie pliki i test tej kolejki. */
export { dniSlowo } from "../ui";

/**
 * Dni do terminu — jedyna liczba na wierszu, którą czyta się jako pilność.
 *
 * `null` = paczka jeszcze nie wróciła, więc zegar obsługi nie ruszył (0.339.0).
 * Pusta pastylka wyglądałaby jak „zero dni", czyli odwrotnie niż jest; szare
 * „czeka na paczkę" mówi prawdę i nie udaje pilności.
 */
function Termin({ dni }: { dni: number | null }) {
  if (dni === null) {
    /* `text-slate-600`, nie 500: na `bg-slate-100` tamten daje 4,34:1 przy
       progu 4,5 — pilnuje tego `Kontrast.test.ts`. */
    return <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
      title="Termin obsługi rusza dopiero, gdy paczka wróci do nas">czeka na paczkę</span>;
  }
  const pilne = dni <= 3;
  const tekst = dni < 0 ? `${dniSlowo(Math.abs(dni))} po` : dni === 0 ? "dziś" : dniSlowo(dni);
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold tabular-nums ${
    pilne ? "bg-red-100 text-ranga-zle" : "bg-slate-100 text-slate-600"}`}
    title={`Termin obsługi (7 dni od paczki u nas): ${
      dni < 0 ? "przekroczony" : "za " + dniSlowo(dni)}`}>{tekst}</span>;
}

export function Kolejka({ zwroty, wybrany, zKubelkiem = false, onWybierz }: {
  zwroty: Zwrot[];
  wybrany: number | null;
  /** Przy szukaniu lista miesza kubełki, więc wiersz musi powiedzieć swój. */
  zKubelkiem?: boolean;
  onWybierz: (id: number) => void;
}) {
  const aktywnyWiersz = useRef<HTMLButtonElement | null>(null);

  /* Od 0.165.0 kolejka jest zamknięta we własnym scrollerze, więc wybór trzeba
     DOGONIĆ widokiem — inaczej `j` przesuwa zaznaczenie poza dolną krawędź
     i operator steruje czymś, czego nie widzi.

     `block: "nearest"` załatwia przy okazji mysz: wiersz widoczny w całości
     nie jest przewijany wcale, a klikniętego nie da się kliknąć, nie widząc
     go. Flaga „skąd przyszła zmiana" byłaby drugim stanem do utrzymania po to,
     żeby wyłączyć operację, która i tak jest pusta.

     Efekt biegnie po zmianie `wybrany`, a nie przy każdym renderze: inaczej
     odświeżenie zapytania szarpałoby listę z powrotem do zaznaczenia, gdy
     operator przewinął ją ręcznie. */
  useEffect(() => { aktywnyWiersz.current?.scrollIntoView({ block: "nearest" }); }, [wybrany]);

  if (!zwroty.length) {
    return <Pusto waga="lista">
      {zKubelkiem
        ? "Żaden zwrot nie pasuje do tego, czego szukasz."
        : "Ten kubełek jest pusty — nic tu nie czeka na ruch."}</Pusto>;
  }
  /* Pierwsza paczka w drodze dostaje nad sobą przegródkę (0.479.0). Ekran
     ustawia takie zwroty na końcu (`Zwroty.tsx`), a przegródka mówi, że od
     tego miejsca nie ma już czego obsługiwać — zamiast kazać to czytać
     z pastylki w każdym wierszu. */
  const wDrodze = (z: Zwrot) => z.dniDoTerminu === null
    && z.kubelek !== "zamkniety" && z.kubelek !== "odrzucony";
  const pierwszaWDrodze = zwroty.findIndex(wDrodze);
  const ileWDrodze = zwroty.filter(wDrodze).length;
  return <ul className="divide-y divide-slate-200">
    {zwroty.map((z, i) => {
      const aktywny = z.id === wybrany;
      const przegrodka = i === pierwszaWDrodze && i > 0
        ? <li key={`w-drodze-${z.id}`} className="bg-slate-50 px-3 py-1 text-xs text-slate-600">
            Paczka jeszcze w drodze · {ileWDrodze}</li>
        : null;
      const sztuki = z.pozycje.reduce((s, p) => s + p.ilosc, 0);
      return <React.Fragment key={z.id}>{przegrodka}<li>
        <button
          /* `aria-current` zamiast samego koloru: wiersz wybrany klawiaturą
             ma być wybrany także dla czytnika ekranu. */
          aria-current={aktywny ? "true" : undefined}
          ref={aktywny ? aktywnyWiersz : null}
          onClick={() => onWybierz(z.id)}
          /* Zaznaczenie szare, marka na belce 3 px — powód przy tej samej
             klauzuli w `skrzynka/Kolejka.tsx`. Belka stoi przy KAŻDYM wierszu,
             bo dokładana przy zaznaczeniu przesuwałaby treść o trzy piksele. */
          /* `py-2`, nie `py-3` (audyt, 15 września 2026). Cztery piksele na
             wiersz to przy siedmiu zwrotach cały ósmy wiersz w oknie laptopa —
             a wiersz ma 86 px i bez tamtych czterech. Cel kliknięcia na blacie
             mierzy się myszą, nie kciukiem (`docs/ergonomia-magazynu.md`,
             zakres dekalogu). */
          className={`flex w-full gap-3 border-l-[3px] px-4 py-2 text-left ${aktywny
            ? "border-l-wertis-amber bg-slate-200"
            : "border-l-transparent hover:bg-slate-50"}`}>
          {/* Miniatura PIERWSZEJ pozycji. Zwrot wielopozycyjny i tak
              rozstrzyga się w kolumnie dowodów, a rząd czterech kafli
              zrobiłby z wiersza tabelę. */}
          <Zdjecie twId={z.pozycje[0]?.twId ?? null} rozmiar={44}
            nazwa={z.pozycje[0]?.nazwa} />
          <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Paczka nieodebrana nie ma numeru zwrotu — jej identyfikator to
                nasz `nieodebrana:<numer listu>`, więc pokazujemy sam numer
                listu i mówimy wprost, czym to jest. */}
            {/* LOGIN PRZY NUMERZE, NIE W OSOBNEJ LINIJCE (audyt, 15 września
                2026). 0.337.0 postawiło go osobno z jednego powodu: „nazwa i tak
                bywa ucięta" — czyli żeby NIE dokleić go do nazwy towaru. Powód
                dotyczył linijki drugiej i dalej obowiązuje; pierwsza ma miejsce,
                bo numer zwrotu ma kilkanaście znaków, a nie kilkadziesiąt.
                Osobna linijka kosztowała 16 px razy długość kolejki. */}
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate font-bold">
                {z.zrodlo === "nieodebrana"
                  ? (z.externalId.replace(/^nieodebrana:/, "") || "bez numeru")
                  : (z.numer ?? z.externalId)}</span>
              {z.kupujacyLogin &&
                <span className="truncate text-xs text-slate-500">{z.kupujacyLogin}</span>}
            </span>
            {z.zrodlo === "nieodebrana" &&
              <span title="Klient nie odebrał przesyłki — to nie jest zgłoszony zwrot"
                className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-bold text-violet-800">
                nieodebrana</span>}
            {/* PLAKIETKI PROWADZĄCEGO TU JUŻ NIE MA (0.370.0). Stała od
                0.315.0; zwroty prowadzi całe biuro, więc odpowiadała na pytanie,
                którego przy tej kolejce nikt nie zadaje. */}
            <span className="ml-auto" />
            {/* Wynik szukania bywa z kubełka, którego nikt nie ogląda —
                bez tej etykiety zwrot ZAMKNIĘTY wyglądałby jak praca. */}
            {zKubelkiem && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-600">
              {KUBELKI.find((k) => k.id === z.kubelek)?.etykieta}</span>}
            <Termin dni={z.dniDoTerminu} />
          </div>
          <div className="mt-0.5 truncate text-sm text-slate-600">
            {z.pozycje[0]?.nazwa ?? "Zwrot bez pozycji"}
            {z.pozycje.length > 1 ? ` i ${ile(z.pozycje.length - 1, "inna", "inne", "innych")}` : ""}
            {sztuki ? ` · ${sztuki} szt.` : ""}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums">
              {zlote(z.sumaPozycjiGrosze, z.waluta)}</span>
            {z.sygnaly.map((s) => (
              <span key={s} title={SYGNALY[s].tytul}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold ${SYGNALY[s].klasa}`}>
                {SYGNALY[s].ikona}{SYGNALY[s].krotko}
              </span>
            ))}
          </div>
          </div>
        </button>
      </li></React.Fragment>;
    })}
  </ul>;
}
