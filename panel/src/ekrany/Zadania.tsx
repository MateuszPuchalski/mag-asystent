import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, PackageX, Plus, RotateCcw, Ruler, Undo2, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import { useAnulujZadanie, useNoweZadanie, usePonowZadanie, useZadania } from "../api/rozmowy";
import { Blad, FiltrSegmentowy, Karta, Przycisk, Pusto, czas } from "../ui";
import { Kafel } from "../towar/Kafel";
import type { Zadanie } from "../api/typy";

const Schemat = z.object({
  rodzaj: z.enum(["pomiar", "zdjecie", "weryfikacja", "inne"]),
  priorytet: z.enum(["normalny", "pilny"]),
  tytul: z.string().trim().min(3, "Tytuł ma powiedzieć hali, co zrobić"),
  instrukcja: z.string().trim().min(3, "Bez instrukcji pomiar wraca niepełny"),
});
type Dane = z.infer<typeof Schemat>;

function NoweZadanie({ zamknij }: { zamknij: () => void }) {
  const [towar, setTowar] = useState<Towar | null>(null);
  const [blad, setBlad] = useState("");
  const zapisz = useNoweZadanie();
  const { register, handleSubmit, formState } = useForm<Dane>({
    resolver: zodResolver(Schemat),
    defaultValues: { rodzaj: "pomiar", priorytet: "normalny", tytul: "", instrukcja: "" },
  });
  const komunikat = Object.values(formState.errors)[0]?.message;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <form className="card w-full max-w-xl p-6" onSubmit={handleSubmit((d) =>
      zapisz.mutate({ ...d, twId: towar ? towar.id : null },
        { onSuccess: zamknij, onError: (e) => setBlad((e as Error).message) }))}>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-naglowek font-bold">Nowe zadanie dla magazynu</h2>
        <button type="button" onClick={zamknij} className="text-slate-500" aria-label="Zamknij">✕</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Rodzaj
          <select className="field mt-1" {...register("rodzaj")}>
            <option value="pomiar">Pomiar</option><option value="zdjecie">Zdjęcie</option>
            <option value="weryfikacja">Weryfikacja</option><option value="inne">Inne</option>
          </select></label>
        <label className="text-sm font-semibold">Priorytet
          <select className="field mt-1" {...register("priorytet")}>
            <option value="normalny">Normalny</option><option value="pilny">Pilny</option>
          </select></label>
      </div>
      <label className="mt-4 block text-sm font-semibold">Tytuł
        <input className="field mt-1" placeholder="Np. zmierz rozstaw otworów" {...register("tytul")} /></label>
      <label className="mt-4 block text-sm font-semibold">Instrukcja
        <textarea className="field mt-1 min-h-28" placeholder="Co i jak zmierzyć; podaj jednostkę."
          {...register("instrukcja")} /></label>
      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold">Towar
          <span className="font-normal text-slate-500"> (opcjonalnie — hala zobaczy symbol i półkę)</span></div>
        <Wyszukiwarka wybrany={towar} onWybierz={setTowar} />
      </div>
      <div className="mt-4"><Blad>{komunikat ?? blad}</Blad></div>
      <div className="mt-6 flex justify-end gap-2">
        <Przycisk type="button" onClick={zamknij}>Anuluj</Przycisk>
        <Przycisk wariant="glowny" disabled={zapisz.isPending}>
          <Ruler size={17} />Wyślij na kolektor</Przycisk>
      </div>
    </form>
  </div>;
}

const FILTRY = [["otwarte", "Otwarte"], ["odeslane", "Odesłane"],
  ["wykonane", "Wykonane"], ["wszystkie", "Wszystkie"]] as const;

/** Zdanie po polsku dla kodu powodu — klucz w API, polszczyzna na ekranie. */
const POWODY: Record<string, string> = {
  brak_towaru: "Brak towaru",
  nie_da_sie: "Nie da się wykonać",
};

/* ── ODESŁANE WRACA DO BIURA (0.352.0) ───────────────────────────────────────
   Hala do 0.351.0 miała jedno wyjście — wynik — więc magazynier przed pustą
   półką albo wpisywał brak JAKO WYNIK, albo zostawiał zadanie w toku na
   zawsze. Teraz odsyła je z powodem, a ruch wraca tutaj i MUSI mieć stąd
   wyjście: ponowienie albo anulowanie. Bez tych dwóch przycisków odesłanie
   byłoby tylko nową ślepą uliczką, tyle że lepiej opisaną.

   Instrukcja jest edytowalna od razu, bez osobnego okna: reakcją na
   „nie da się" jest zwykle przeformułowanie zlecenia, a nie powtórzenie go
   słowo w słowo. Zakładanie DRUGIEGO zadania zrywałoby powiązanie z rozmową,
   więc wynik przestałby wracać na jej oś.                                    */
function Odeslane({ zadanie }: { zadanie: Zadanie }) {
  /* FIOLET, nie czerwień. Czerwień na tym ekranie znaczy już „pilne"
     (`border-red-300`), a kafel `rose-100` obok `red-100` to dla oka ta sama
     plama. Odesłanie nie jest też awarią — jest odpowiedzią, tyle że inną niż
     oczekiwana, i ma się odróżniać od wszystkich trzech stanów naraz. */
  const [ponawiam, setPonawiam] = useState(false);
  const [instrukcja, setInstrukcja] = useState(zadanie.instrukcja);
  const [blad, setBlad] = useState("");
  const ponow = usePonowZadanie();
  const anuluj = useAnulujZadanie();
  const zajete = ponow.isPending || anuluj.isPending;

  return <div className="border-t bg-violet-50 p-5">
    <div className="flex items-center gap-2 text-violet-900">
      <PackageX size={17} />
      <span className="text-xs font-bold uppercase">
        Hala odesłała: {POWODY[zadanie.powodKod ?? ""] ?? "bez powodu"}</span>
    </div>
    {zadanie.powod && <p className="mt-2 whitespace-pre-wrap text-tresc text-slate-700">{zadanie.powod}</p>}
    <p className="mt-2 text-xs text-slate-600">
      {zadanie.odeslanoPrzez} · {czas(zadanie.odeslanoAt)}</p>

    {ponawiam && <label className="mt-4 block text-sm font-semibold">Instrukcja przy ponowieniu
      <textarea className="field mt-1 min-h-24" value={instrukcja}
        onChange={(e) => setInstrukcja(e.target.value)} /></label>}
    <div className="mt-3"><Blad>{blad}</Blad></div>
    <div className="mt-3 flex flex-wrap gap-2">
      {ponawiam
        ? <>
          <Przycisk wariant="glowny" disabled={zajete} onClick={() => ponow.mutate(
            { id: zadanie.id, instrukcja }, { onError: (e) => setBlad((e as Error).message) })}>
            <RotateCcw size={16} />ZLEĆ PONOWNIE</Przycisk>
          <Przycisk onClick={() => { setPonawiam(false); setBlad(""); }}>Nie teraz</Przycisk>
        </>
        : <>
          <Przycisk wariant="glowny" disabled={zajete} onClick={() => setPonawiam(true)}>
            <RotateCcw size={16} />ZLEĆ PONOWNIE</Przycisk>
          <Przycisk disabled={zajete} onClick={() => anuluj.mutate(
            { id: zadanie.id }, { onError: (e) => setBlad((e as Error).message) })}>
            <X size={16} />ANULUJ ZADANIE</Przycisk>
        </>}
    </div>
  </div>;
}

export function Zadania() {
  const [filtr, setFiltr] = useState<string>("otwarte");
  const [modal, setModal] = useState(false);
  const zadania = useZadania();

  const wszystkie = zadania.data?.zadania ?? [];
  /* `odeslane` wchodzi do „Otwartych" MIMO własnej zakładki. Zakładka jest
     skrótem dla kogoś, kto przyszedł po nie; „Otwarte" to widok domyślny,
     a zadanie czekające na decyzję biura wypadłoby z niego bez śladu — czyli
     dokładnie tak, jak gubiło się przed tą wersją. Serwer stawia je na
     wierzchu swojego pasma pilności, więc szukać go nie trzeba. */
  const widoczne = wszystkie.filter((t) =>
    filtr === "wszystkie" || (filtr === "otwarte"
      ? ["nowe", "w_toku", "odeslane"].includes(t.status) : t.status === filtr));
  const odeslanych = wszystkie.filter((t) => t.status === "odeslane").length;

  /* Ekran ma własny scroller, bo rama panelu trzyma się okna (0.165.0)
     i celowo nie przewija za ekrany. Poniżej `lg` klasa jest bezczynna:
     bez związanej wysokości nie ma czego przewijać. */
  return <div className="lg:h-full lg:overflow-y-auto">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-tytul font-bold">Zadania terenowe</h1>
        {/* slate-600, nie slate-500 (0.255.0): ten akapit stoi na TLE STRONY
            (`body` ma `bg-slate-100`), a tam slate-500 daje 4.34:1 przy progu
            4.5. W kartach, czyli na bieli, slate-500 wystarcza. */}
        <p className="text-sm text-slate-600">Pomiary i weryfikacje wracają bezpośrednio z kolektorów.</p>
      </div>
      <div className="flex items-center gap-3">
        {/* Filtr miał WŁASNĄ bieżnię — białą, w obwódce, z pigułką 14 px na
            `px-4 py-2` — i jako jedyny z sześciu nie miał `aria-pressed`.
            Kształt idzie pod wspólny, czyli schodzi na szczebel kontrolki.
            Bieżnia zostaje szara jak wszędzie: niewybrana pigułka Z TŁEM mówi
            „wybiera się jedną z tych", a bez tła mówiła „oto trzy rzeczy do
            kliknięcia" — a to jest jeden wybór, nie trzy. */}
        <div className="flex gap-1">
          {/* Licznik TYLKO przy odesłanych i tylko wtedy, gdy są. Liczba przy
              każdej zakładce byłaby tłem; tutaj mówi o pracy, która stoi po
              stronie biura i nikt jej nie zabierze. */}
          <FiltrSegmentowy<string> wybrany={filtr} onWybierz={setFiltr}
            pozycje={FILTRY.map(([v, l]) => ({
              klucz: v,
              etykieta: v === "odeslane" && odeslanych ? `${l} (${odeslanych})` : l,
            }))} />
        </div>
        <Przycisk wariant="glowny" onClick={() => setModal(true)}>
          <Plus size={18} />ZADANIE DLA MAGAZYNU</Przycisk>
      </div>
    </div>
    <div className="mb-4"><Blad>{(zadania.error as Error | null)?.message}</Blad></div>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {widoczne.map((t) => <Karta key={t.id}
        className={`overflow-hidden ${t.status === "odeslane" ? "border-violet-400"
          : t.priorytet === "pilny" ? "border-red-300" : ""}`}>
        <div className="flex items-start gap-3 p-5">
          <div className={`rounded-lg p-2 ${t.status === "odeslane" ? "bg-violet-100 text-violet-800"
            : t.status === "wykonane" ? "bg-emerald-100 text-emerald-700"
            : t.priorytet === "pilny" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
            {t.status === "odeslane" ? <Undo2 /> : t.status === "wykonane" ? <CheckCircle2 />
              : t.priorytet === "pilny" ? <AlertTriangle /> : <Ruler />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-bold">{t.tytul}</h2>
              {t.priorytet === "pilny" &&
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">PILNE</span>}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-tresc text-slate-600">{t.instrukcja}</p>
          </div>
        </div>
        {/* ── PASEK TOWARU ZE ZDJĘCIEM (0.203.0) ────────────────────────
            Zadanie terenowe zleca się na konkretną kartotekę, a kafelek
            mówił o niej symbolem i nazwą w jednej linijce. Biuro zleca
            pomiary seriami i wraca do tego ekranu po wyniki — wtedy pytanie
            brzmi „które to było", a odpowiada na nie kształt części.
            Kolektor pokazuje zdjęcie przy zadaniu od dawna (§ zadania
            terenowe); ekran zlecającego był jedynym końcem tej pary bez
            obrazu.

            Nazwa idzie przed symbolem, jak w wyszukiwarce: to ona wraca
            w rozmowie z magazynem. */}
        {t.symbol && <div className="flex items-center gap-3 border-y bg-slate-50 px-5 py-3 text-sm">
          <Kafel twId={t.twId} rozmiar={48} nazwa={t.nazwaTowaru ?? t.symbol} symbol={t.symbol} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{t.nazwaTowaru}</div>
            <div className="truncate font-mono text-xs text-slate-600">{t.symbol}</div>
            <div className="text-xs text-slate-500">Lokalizacja: {t.lokalizacja || "brak"}</div>
          </div>
        </div>}
        <div className="space-y-2 p-5 text-sm">
          {t.przypisanoPrzez && <p><Clock className="mr-2 inline" size={15} />
            {t.status === "wykonane" ? "Wykonał" : "Realizuje"}:{" "}
            <b>{t.status === "wykonane" ? t.wykonanoPrzez : t.przypisanoPrzez}</b></p>}
          {t.wynik && <div className="rounded-lg bg-os-wynik p-3">
            <div className="mb-1 text-xs font-bold uppercase text-ranga-ok">Wynik z magazynu</div>
            <p className="whitespace-pre-wrap text-tresc">{t.wynik}</p></div>}
          <p className="text-xs text-slate-500">Zlecił(a) {t.utworzonoPrzez} · {czas(t.utworzonoAt)}</p>
        </div>
        {t.status === "odeslane" && <Odeslane zadanie={t} />}
      </Karta>)}
    </div>
    {!widoczne.length && <Karta className="grid place-items-center p-16">
      <Pusto ikona={ClipboardList}>Brak zadań w tym widoku</Pusto></Karta>}
    {modal && <NoweZadanie zamknij={() => setModal(false)} />}
  </div>;
}
