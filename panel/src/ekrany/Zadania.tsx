import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Plus, Ruler } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import { useNoweZadanie, useZadania } from "../api/rozmowy";
import { Blad, Karta, Przycisk, Pusto, czas } from "../ui";
import { Kafel } from "../towar/Kafel";

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
        <h2 className="text-xl font-bold">Nowe zadanie dla magazynu</h2>
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

const FILTRY = [["otwarte", "Otwarte"], ["wykonane", "Wykonane"], ["wszystkie", "Wszystkie"]] as const;

export function Zadania() {
  const [filtr, setFiltr] = useState<string>("otwarte");
  const [modal, setModal] = useState(false);
  const zadania = useZadania();

  const widoczne = (zadania.data?.zadania ?? []).filter((t) =>
    filtr === "wszystkie" || (filtr === "otwarte" ? ["nowe", "w_toku"].includes(t.status) : t.status === filtr));

  /* Ekran ma własny scroller, bo rama panelu trzyma się okna (0.165.0)
     i celowo nie przewija za ekrany. Poniżej `lg` klasa jest bezczynna:
     bez związanej wysokości nie ma czego przewijać. */
  return <div className="lg:h-full lg:overflow-y-auto">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">Zadania terenowe</h1>
        <p className="text-sm text-slate-500">Pomiary i weryfikacje wracają bezpośrednio z kolektorów.</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border bg-white p-1">
          {FILTRY.map(([v, l]) => <button key={v} onClick={() => setFiltr(v)}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${
              filtr === v ? "bg-wertis-ink text-white" : "text-slate-600"}`}>{l}</button>)}
        </div>
        <Przycisk wariant="glowny" onClick={() => setModal(true)}>
          <Plus size={18} />ZADANIE DLA MAGAZYNU</Przycisk>
      </div>
    </div>
    <div className="mb-4"><Blad>{(zadania.error as Error | null)?.message}</Blad></div>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {widoczne.map((t) => <Karta key={t.id}
        className={`overflow-hidden ${t.priorytet === "pilny" ? "border-red-300" : ""}`}>
        <div className="flex items-start gap-3 p-5">
          <div className={`rounded-lg p-2 ${t.status === "wykonane" ? "bg-emerald-100 text-emerald-700"
            : t.priorytet === "pilny" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
            {t.status === "wykonane" ? <CheckCircle2 /> : t.priorytet === "pilny" ? <AlertTriangle /> : <Ruler />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-bold">{t.tytul}</h2>
              {t.priorytet === "pilny" &&
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">PILNE</span>}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{t.instrukcja}</p>
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
            <p className="whitespace-pre-wrap">{t.wynik}</p></div>}
          <p className="text-xs text-slate-400">Zlecił(a) {t.utworzonoPrzez} · {czas(t.utworzonoAt)}</p>
        </div>
      </Karta>)}
    </div>
    {!widoczne.length && <Karta className="grid place-items-center p-16">
      <Pusto ikona={<ClipboardList size={38} />}>Brak zadań w tym widoku</Pusto></Karta>}
    {modal && <NoweZadanie zamknij={() => setModal(false)} />}
  </div>;
}
