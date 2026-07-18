import type { MmItem, SferaAdapter } from "./sfera.js";

/**
 * PRODUKCJA — zapis do Subiekta GT przez Sferę (COM) na Windows (spec §9).
 *
 * NIE uruchamiane w tym środowisku (Sfera to COM/Windows + licencja, wymaga
 * maszyny z zainstalowanym Subiektem). Szkielet kontraktu:
 *
 * Rekomendacja spec §9: worker jako proces na Windows — C# (stabilniejszy COM
 * interop) lub Python + pywin32. Ten plik to punkt integracji, jeśli worker
 * pozostaje w Node (np. przez `winax`/`edge-js`); w praktyce częściej jest to
 * osobny proces C#/Python czytający tę samą tabelę `sfera_queue`.
 *
 * set_location:
 *   var t = sfera.TowaryManager.Wczytaj(twId);
 *   t.PoleWlasne["Lokalizacja"] = newValue;   // lub dedykowane pole — [WERYFIKUJ]
 *   t.Zapisz();
 *   // PLAN B (spec §9): jeśli Sfera nie eksponuje pola lokalizacji —
 *   //   UPDATE tw__Towar SET tw_Lokalizacja=@v WHERE tw_Id=@id
 *   //   osobnym loginem z GRANT UPDATE wyłącznie na tę kolumnę (brak triggerów).
 *
 * createMM (MGP→MAG):
 *   var mm = sfera.DokumentyMagazynoweManager.DodajMM();
 *   mm.MagazynZrodlowy = magFrom; mm.MagazynDocelowy = magTo;
 *   foreach (it in items) { var p = mm.Pozycje.Dodaj(it.twId); p.IloscJm = it.qty; }
 *   mm.Zapisz();
 *   return mm.NumerPelny;   // zapis zwrotny do sfera_queue.sgt_doc_number
 *
 * Sekwencyjność: COM Sfery nie jest thread-safe — przetwarzać po jednym zadaniu.
 */
export class ComSferaAdapter implements SferaAdapter {
  constructor() {
    throw new Error(
      "ComSferaAdapter: uruchom worker na Windows z Subiektem GT + Sferą (§9). " +
        "Nieuruchamialny w środowisku chmurowym."
    );
  }
  applySetLocation(_twId: number, _newValue: string): Promise<void> {
    throw new Error("not implemented");
  }
  createMM(_magFrom: number, _magTo: number, _items: MmItem[]): Promise<string> {
    throw new Error("not implemented");
  }
}
