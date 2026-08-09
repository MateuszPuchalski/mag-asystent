/**
 * SferaAdapter — granica ZAPISU do Subiekta GT (spec §9).
 * Worker jest jedynym miejscem, które go używa; kolektor nigdy nie czeka
 * synchronicznie na COM (spec §12).
 *
 * Implementacje (wybór wynika z SGT_MODE — patrz adapters/index.ts):
 *   dev — mutacja tabel sgt_* (sfera.dev.ts): realna zmiana stanu w read-modelu,
 *         jedyny sposób na przećwiczenie ścieżki kolejka→worker bez Subiekta.
 *   sql — UPDATE jednej kolumny w MSSQL (sfera.sql.ts): pole lokalizacji,
 *         loginem o kolumnowym uprawnieniu; MM zgłasza błąd.
 *
 * ─── Zapis przez Sferę (COM) — kontrakt ZREALIZOWANY w sfera-worker/ ─────────
 * Sfera to COM/Windows + licencja, więc nie ma tu implementacji w Node.
 * Worker Sfery istnieje jako osobny proces C#/.NET w `sfera-worker/` (czyta tę
 * samą tabelę `sfera_queue`, wyłącznie zadania `mm`; wdrożenie: DEPLOY §6
 * etap 2). Wywołania COM tam są szkicem z tego kontraktu i noszą [WERYFIKUJ]
 * do potwierdzenia na żywej Sferze. Szkic:
 *
 * set_location:
 *   var t = sfera.TowaryManager.Wczytaj(twId);
 *   t.PoleWlasne["Lokalizacja"] = newValue;   // lub dedykowane pole — [WERYFIKUJ]
 *   t.Zapisz();
 *   // PLAN B (spec §9), już zaimplementowany w sfera.sql.ts: jeśli Sfera nie
 *   //   eksponuje pola lokalizacji — UPDATE tw__Towar SET tw_Lokalizacja=@v
 *   //   osobnym loginem z GRANT UPDATE wyłącznie na tę kolumnę.
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
export interface MmItem {
  twId: number;
  qty: number;
}

export interface SferaAdapter {
  /** Ustaw pole lokalizacji na kartotece towaru (spec §5.2). */
  applySetLocation(twId: number, newValue: string): Promise<void>;
  /**
   * Ustaw podstawowy kod kreskowy kartoteki — `tw_PodstKodKresk` (0.37.0).
   *
   * DRUGIE pole, które aplikacja zmienia w bazie firmy. Rozszerzenie tej
   * granicy było świadome i kosztuje osobne uprawnienie kolumnowe; powód —
   * karton z kodem, którego kartoteka nie zna — stoi w `services/ean-alias.ts`.
   */
  applySetEan(twId: number, ean: string): Promise<void>;
  /**
   * Utwórz dokument MM (magazyn źródłowy → docelowy), przesuń pozycje,
   * zwróć numer dokumentu MM (spec §5.3 / §9).
   */
  createMM(magFrom: number, magTo: number, items: MmItem[]): Promise<string>;
}
