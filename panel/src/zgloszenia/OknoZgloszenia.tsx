import React, { useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ImagePlus, MessageSquarePlus, X } from "lucide-react";
import dane from "virtual:wertis-zmiany";
import {
  NAJWIECEJ_ZDJEC, NAZWA_RODZAJU, NAZWA_STATUSU, PLAKIETKA_STATUSU, RODZAJE,
  useMojeZgloszenia, useWyslijZgloszenie, type RodzajZgloszenia,
} from "../api/zgloszenia";
import { useOkno } from "../nawigacja/fokus";
import { Blad, FiltrSegmentowy, Plakietka, Przycisk, kiedy } from "../ui";
import { przygotujZdjecie } from "./zdjecie";

/* ── ZGŁOŚ UWAGĘ Z KAŻDEGO EKRANU ──────────────────────────────────────────
   Uwaga z biura ginie w rozmowie przy kawie, a właściciel słyszy o irytacji,
   gdy ktoś już się do niej przyzwyczaił. Przycisk stoi w dolnym bloku paska
   bocznego, więc jest na każdym ekranie i łapie uwagę w chwili, gdy boli.

   Okno dopisuje samo adres ekranu i wersję panelu. Pracownik nie musi
   pamiętać, gdzie był, a właściciel wie, które wydanie przeszkadza.

   ZRZUTU EKRANU PANEL NIE ROBI SAM, decyzją właściciela. Na zrzucie stałyby
   dane kupujących, a zgłoszenie ich nie potrzebuje. Zdjęcie wkleja albo
   wybiera człowiek, więc widzi, co wysyła.

   Pod formularzem stoją własne zgłoszenia z odpowiedzią właściciela. Uwaga,
   na którą nikt nie odpowiada, jest ostatnią, jaką ktoś zgłosi. */

/** Najdłuższy opis, jaki przyjmuje serwer. */
const NAJDLUZSZY_OPIS = 4000;
/** Ile własnych zgłoszeń pokazujemy pod formularzem; resztę zna właściciel. */
const MOICH_NA_OKNIE = 5;

/**
 * Adres ekranu bez danych klienta. Zapytanie odpada samo, bo bierzemy
 * `pathname`. Profil klienta niesie login w ścieżce, a login jest kluczem
 * kupującego, więc zostaje sam adres ekranu.
 */
export function ekranZgloszenia(pathname: string): string {
  return pathname.replace(/^(\/obsluga\/klient)\/[^/]+/, "$1/:login").slice(0, 200);
}

/** Przycisk paska bocznego. Sama ikona, bo zwinięty pasek ma 80 px szerokości. */
export function PrzyciskZgloszenia() {
  const [otwarte, setOtwarte] = useState(false);
  return <>
    <button type="button" onClick={() => setOtwarte(true)} aria-haspopup="dialog"
      aria-label="Zgłoś uwagę lub pomysł" title="Zgłoś uwagę lub pomysł"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:bg-white/15">
      <MessageSquarePlus size={18} />
    </button>
    {otwarte && <OknoZgloszenia onZamknij={() => setOtwarte(false)} />}
  </>;
}

interface Zdjecie { id: number; adres: string }

export function OknoZgloszenia({ onZamknij }: { onZamknij: () => void }) {
  const { pathname } = useLocation();
  const id = useId();
  const [rodzaj, setRodzaj] = useState<RodzajZgloszenia | null>(null);
  const [opis, setOpis] = useState("");
  const [zdjecia, setZdjecia] = useState<Zdjecie[]>([]);
  const [wToku, setWToku] = useState(0);
  const [odmowa, setOdmowa] = useState<string | null>(null);
  const [dziekujemy, setDziekujemy] = useState(false);
  const wyslij = useWyslijZgloszenie();
  const wejscie = useRef<HTMLInputElement>(null);
  const kolejny = useRef(0);
  /* Miejsca liczone synchronicznie, nie ze stanu. Dwa wklejenia tuż po sobie
     widziałyby ten sam stan i razem przekroczyłyby limit czterech zdjęć. */
  const zajete = useRef(0);

  /* Escape zamyka tylko puste okno. Opis pisany kilka minut nie ma prawa
     zniknąć od klawisza wciśniętego z przyzwyczajenia. */
  const zaczete = rodzaj !== null || opis.trim() !== "" || zdjecia.length > 0 || wToku > 0;
  const okno = useOkno<HTMLDivElement>({ onZamknij: zaczete ? undefined : onZamknij });

  const zmiana = () => { setDziekujemy(false); wyslij.reset(); };

  const dolacz = async (pliki: File[]) => {
    zmiana();
    const obrazy = pliki.filter((p) => p.type.startsWith("image/"));
    if (obrazy.length === 0) { setOdmowa("To nie jest zdjęcie. Dołącz plik JPEG albo PNG."); return; }
    const brane = obrazy.slice(0, Math.max(0, NAJWIECEJ_ZDJEC - zajete.current));
    zajete.current += brane.length;
    setOdmowa(brane.length < obrazy.length
      ? `Najwyżej ${NAJWIECEJ_ZDJEC} zdjęcia przy jednym zgłoszeniu. Nadmiarowe pominąłem.` : null);
    if (brane.length === 0) return;
    setWToku((n) => n + brane.length);
    for (const plik of brane) {
      try {
        const adres = await przygotujZdjecie(plik);
        setZdjecia((z) => [...z, { id: ++kolejny.current, adres }]);
      } catch (e) {
        zajete.current -= 1;
        setOdmowa(e instanceof Error ? e.message : String(e));
      } finally {
        setWToku((n) => n - 1);
      }
    }
  };

  const usun = (zid: number) => {
    zajete.current -= 1;
    setZdjecia((z) => z.filter((x) => x.id !== zid));
    setOdmowa(null);
  };

  /* Wklejenie przechwytujemy tylko wtedy, gdy schowek niesie obraz. Zwykły
     tekst wklejony do opisu idzie dalej, do pola. */
  const naWklejenie = (e: React.ClipboardEvent) => {
    const schowek = e.clipboardData;
    const zPlikow = Array.from(schowek?.files ?? []);
    const pliki = zPlikow.length > 0 ? zPlikow
      : Array.from(schowek?.items ?? []).filter((i) => i.kind === "file")
        .map((i) => i.getAsFile()).filter((f): f is File => f !== null);
    if (!pliki.some((p) => p.type.startsWith("image/"))) return;
    e.preventDefault();
    void dolacz(pliki);
  };

  const tresc = opis.trim();
  const zaDlugi = tresc.length > NAJDLUZSZY_OPIS;
  const gotowe = rodzaj !== null && tresc.length > 0 && !zaDlugi && wToku === 0 && !wyslij.isPending;
  const pelne = zdjecia.length + wToku >= NAJWIECEJ_ZDJEC;
  const brakuje = wyslij.isPending ? null
    : rodzaj === null ? "Wybierz rodzaj i opisz, co się dzieje."
      : tresc === "" ? "Opisz, co się dzieje."
        : wToku > 0 ? "Czekam na zdjęcia." : null;

  const zloz = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gotowe || rodzaj === null) return;
    wyslij.mutate({
      rodzaj, opis: tresc, ekran: ekranZgloszenia(pathname), zrodlo: "panel",
      ...(dane.wersja ? { wersja: dane.wersja.slice(0, 40) } : {}),
      zdjecia: zdjecia.map((z) => z.adres),
    }, {
      onSuccess: () => {
        setRodzaj(null); setOpis(""); setZdjecia([]); setOdmowa(null);
        zajete.current = 0;
        setDziekujemy(true);
      },
    });
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    {/* `text-slate-900` jawnie: okno rysuje się w pasku bocznym z `text-white`,
        a dziedziczona biel na białym tle znika. Ta sama pułapka co w szukaniu. */}
    <div role="dialog" {...okno} aria-labelledby={`${id}-tytul`} onPaste={naWklejenie}
      className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-xl bg-white p-6 text-slate-900 shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-tytul`} className="text-naglowek font-bold">Zgłoś uwagę lub pomysł</h2>
        <button type="button" onClick={onZamknij} aria-label="Zamknij"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
          <X size={18} /></button>
      </div>
      <p className="text-sm text-slate-600">Trafi do właściciela razem z adresem tego ekranu.
        Inni pracownicy go nie zobaczą.</p>

      <form className="flex flex-col gap-3" onSubmit={zloz}>
        <div role="group" aria-label="Rodzaj zgłoszenia" className="flex gap-1">
          <FiltrSegmentowy<RodzajZgloszenia | null> rowne wybrany={rodzaj}
            onWybierz={(r) => { zmiana(); setRodzaj(r); }}
            pozycje={RODZAJE.map((r) => ({ klucz: r.klucz, etykieta: r.etykieta }))} />
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold">Co się dzieje?
          <textarea data-fokus-startowy value={opis} rows={5}
            onChange={(e) => { zmiana(); setOpis(e.target.value); }}
            placeholder="Np. przy zwrocie muszę trzy razy klikać, żeby zobaczyć zamówienie."
            className="field font-normal" />
        </label>
        {zaDlugi && <p className="text-sm text-ranga-zle">Opis ma {tresc.length} znaków, a mieści się {NAJDLUZSZY_OPIS}.</p>}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Przycisk type="button" disabled={pelne} onClick={() => wejscie.current?.click()}>
              <ImagePlus size={16} />Dodaj zdjęcie</Przycisk>
            <span className="text-xs text-slate-600">albo wklej zrzut skrótem Ctrl V · najwyżej {NAJWIECEJ_ZDJEC}</span>
            <input ref={wejscie} type="file" accept="image/*" multiple hidden aria-label="Wybierz zdjęcia"
              onChange={(e) => {
                const pliki = Array.from(e.target.files ?? []);
                /* Czyścimy pole, żeby ten sam plik dało się wybrać drugi raz. */
                e.target.value = "";
                void dolacz(pliki);
              }} />
          </div>
          {(zdjecia.length > 0 || wToku > 0) && <ul aria-label="Dołączone zdjęcia" className="flex flex-wrap gap-2">
            {zdjecia.map((z, i) => <li key={z.id} className="relative">
              <img src={z.adres} alt={`Zdjęcie ${i + 1}`} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
              <button type="button" onClick={() => usun(z.id)} aria-label={`Usuń zdjęcie ${i + 1}`} title="Usuń"
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-white">
                <X size={14} /></button>
            </li>)}
            {wToku > 0 && <li className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-600">
              Zmniejszam…</li>}
          </ul>}
          {odmowa && <p className="text-sm text-ranga-zle">{odmowa}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Przycisk wariant="glowny" type="submit" disabled={!gotowe}>
            {wyslij.isPending ? "Wysyłam…" : "Wyślij zgłoszenie"}</Przycisk>
          {/* Wyłączony przycisk mówi, czego mu brakuje. Bez zdania wygląda
              na zepsuty, a człowiek klika go drugi raz. */}
          {brakuje && <span className="text-xs text-slate-600">{brakuje}</span>}
        </div>
        {/* Podziękowanie w obszarze `status`, więc czytnik ekranu też je słyszy. */}
        <p role="status" className="text-sm font-semibold text-ranga-ok">
          {dziekujemy ? "Dziękujemy. Zgłoszenie dotarło do właściciela." : ""}</p>
        <Blad>{wyslij.error ? (wyslij.error as Error).message : null}</Blad>
      </form>

      <MojeZgloszenia />
    </div>
  </div>;
}

function MojeZgloszenia() {
  const moje = useMojeZgloszenia();
  return <section aria-labelledby="moje-zgloszenia" className="flex flex-col gap-2 border-t border-slate-200 pt-4">
    <h3 id="moje-zgloszenia" className="text-sm font-bold">Twoje zgłoszenia</h3>
    {moje.isError ? <p className="text-sm text-ranga-zle">Nie udało się wczytać twoich zgłoszeń: {(moje.error as Error).message}</p>
      : !moje.data ? <p className="text-sm text-slate-600">Wczytuję…</p>
        : moje.data.zgloszenia.length === 0 ? <p className="text-sm text-slate-600">Nie masz jeszcze zgłoszeń.</p>
          : <ul className="flex flex-col divide-y divide-slate-100">
            {moje.data.zgloszenia.slice(0, MOICH_NA_OKNIE).map((z) => <li key={z.id} className="flex flex-col gap-1 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <Plakietka status={PLAKIETKA_STATUSU[z.status]}>{NAZWA_STATUSU[z.status]}</Plakietka>
                <span className="font-semibold text-slate-800">{NAZWA_RODZAJU[z.rodzaj]}</span>
                <span>{kiedy(z.at)}</span>
              </div>
              <p className="line-clamp-2 text-sm">{z.opis}</p>
              {z.odpowiedz && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-semibold">Odpowiedź{z.statusPrzez ? ` (${z.statusPrzez})` : ""}:</span> {z.odpowiedz}</p>}
            </li>)}
          </ul>}
  </section>;
}
