import React, { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { POLA_FIRMY, useFirma, useZapiszFirme, type DaneFirmy as Dane, type PoleFirmy } from "../api/ustawienia";
import { firmaZPrzegladarki, przegladarkaMaFirme, zDruku } from "../druk/firma";
import { Blad, Pole, Przycisk, czas } from "../ui";
import { KartaWgladu } from "../ui/wglad";

/* ── Dane firmy do protokołów (z `biuro.html`, 0.444.0) ──────────────────
   W biurze karta mówiła „drugie biurko ma własny komplet" — i to była wada,
   nie cecha: nowe biurko drukowało protokół bez nagłówka. Teraz dane są na
   serwerze i jednakowe na każdym biurku.

   PRZENIESIENIE Z PRZEGLĄDARKI JEST PRZYCISKIEM. Ekran mógłby sam wysłać
   komplet z `localStorage` przy pierwszym wejściu, ale wtedy otwarcie
   ustawień zapisywałoby — a tej reguły panel nie łamie dla wygody. Przycisk
   stoi WYŁĄCZNIE, gdy serwer jest pusty i przeglądarka ma dane: później nie
   ma czego przenosić, a propozycja nadpisania cudzego zapisu byłaby pułapką.

   Przycisk wypełnia pola i od razu zapisuje. Samo wypełnienie kazałoby
   klikać drugi raz, a różnicy między „przenieś" a „przenieś i zapisz" nikt
   nie szuka (dekalog pkt 1). */

const ETYKIETY: Record<PoleFirmy, string> = {
  nazwa: "Nazwa firmy", nip: "NIP", adres: "Adres", miejscowosc: "Miejscowość", osoba: "Osoba kontaktowa", telefon: "Telefon",
};

const PUSTE: Dane = { nazwa: "", nip: "", adres: "", miejscowosc: "", osoba: "", telefon: "" };

export function DaneFirmy() {
  const firma = useFirma();
  const zapis = useZapiszFirme();
  const [pola, setPola] = useState<Dane>(PUSTE);
  const [wynik, setWynik] = useState("");

  /* Pola biorą stan serwera przy KAŻDEJ jego zmianie — także po zapisie
     z innego biurka i po przeniesieniu. Edycja w toku by się nie zgubiła,
     bo odczyt odświeża się tylko po własnym zapisie (minuta świeżości). */
  useEffect(() => { if (firma.data) setPola(firma.data.dane); }, [firma.data]);

  const pustySerwer = firma.data?.zmieniono === null;
  const przeniesienie = pustySerwer && przegladarkaMaFirme();

  const zapisz = (dane: Dane, co: string) => {
    setWynik("");
    zapis.mutate(dane, { onSuccess: () => setWynik(co) });
  };

  return <KartaWgladu id="karta-firma" tytul="Dane firmy do protokołów"
    opis={<>Nagłówek protokołu rozbieżności dla dostawcy. Na serwerze — jednakowe na każdym biurku.
      {firma.data?.zmieniono && <> Ostatnio zmienił(a) {firma.data.zmieniono.przez}, {czas(firma.data.zmieniono.at)}.</>}</>}>
    {przeniesienie && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <span className="mr-auto">W tej przeglądarce są dane firmy z dawnego <b>/biuro</b>. Serwer ich jeszcze nie ma.</span>
      <Przycisk wariant="glowny" disabled={zapis.isPending}
        onClick={() => zapisz(zDruku(firmaZPrzegladarki()), "Przeniesiono na serwer — każde biurko drukuje teraz te same dane.")}>
        <Upload size={16} />Przenieś na serwer</Przycisk>
    </div>}
    <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      onSubmit={(e) => { e.preventDefault(); zapisz(pola, "Zapisano."); }}>
      {POLA_FIRMY.map((p) => <label key={p} className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-slate-700">{ETYKIETY[p]}</span>
        <Pole value={pola[p]} maxLength={200} onChange={(e) => setPola((s) => ({ ...s, [p]: e.target.value }))} />
      </label>)}
      <div className="flex items-center gap-3 sm:col-span-2 xl:col-span-3">
        <Przycisk wariant="glowny" type="submit" disabled={zapis.isPending || !firma.data}>Zapisz</Przycisk>
        {wynik && <span className="text-sm text-ranga-ok">{wynik}</span>}
      </div>
    </form>
    <Blad>{firma.error?.message || zapis.error?.message}</Blad>
  </KartaWgladu>;
}
