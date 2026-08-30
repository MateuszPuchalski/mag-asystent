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
 * createKorektaZwrotu (Etap 2 zwrotów, RW dla zniszczonych od 0.67.0):
 *   var kor = sfera.DokumentyHandloweManager.DodajKorekte(dokId);  // KFS/KPA
 *   foreach (p in pozycje + pozycjeZniszczone) kor.Pozycje[...].IloscPoKorekcie -= p.qty;
 *   kor.Zapisz();
 *   // …po niej MM (pełnowartościowe → bufor) oraz RW (zniszczone, z magazynu
 *   // sprzedaży): var rw = sfera.DokumentyMagazynoweManager.DodajRW();
 *   // rw.Magazyn = magZrodlowy; rw.Pozycje.Dodaj(twId).IloscJm = qty; rw.Zapisz();
 *   // Rollback ŁAŃCUCHOWY: pad RW usuwa MM i korektę, pad MM usuwa korektę
 *   // (Usun()) — patrz kontrakt niżej.
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

/**
 * Zlecenie „korekta sprzedaży + MM na bufor zwrotowy" — jedna operacja.
 *
 * OD 0.138.0 NIC TEGO NIE NADAJE: rejestr zwrotów odszedł razem z obsługą
 * klienta, a korektę wystawia biuro w Subiekcie. Kontrakt zostaje, bo worker
 * Sfery (C#) dalej bierze `korekta_zwrot` z kolejki — zadania nadane przed
 * aktualizacją muszą się dokończyć, a nie zawisnąć na nieznanym typie.
 *
 * Pozycje są te same dla obu dokumentów: korekta zdejmuje je ze sprzedaży
 * (stan wraca do magazynu, z którego wyszły), a MM od razu przesuwa je na
 * bufor zwrotowy. Rozdzielenie tego na dwa zadania kolejki dałoby stan,
 * w którym korekta jest wystawiona, a towar leży w magazynie głównym jako
 * sprzedawalny — czyli sprzedany drugi raz, zanim ktokolwiek go obejrzał.
 */
export interface ZlecenieKorekty {
  /** Dokument sprzedaży w Subiekcie (dok_Id) — FS albo PA. */
  dokId: number;
  typ: "FS" | "PA";
  /** Magazyn, z którego towar wyszedł — źródło MM na bufor. */
  magZrodlowy: number;
  /** Bufor zwrotowy — MAG_ID_ZWROTY. */
  magZwrotow: number;
  pozycje: MmItem[];
  /**
   * Pozycje z decyzją „do zniszczenia" (Etap 5). Korekta obejmuje je RAZEM
   * z pełnowartościowymi (klient oddał towar — sprzedaż trzeba skorygować),
   * ale zamiast MM na bufor od razu schodzi po nich RW z magazynu sprzedaży:
   * zniszczony towar nie ma być sprzedawalny ani chwili, a bez RW wisiałby
   * na stanie jako duch. Pole opcjonalne — zadania sprzed 0.67.0 go nie mają.
   */
  pozycjeZniszczone?: MmItem[];
}

/** Numery dokumentów — trafiają do `sfera_queue.wynik_json`. */
export interface WynikKorekty {
  korektaNumer: string;
  /** Pusty string, gdy zlecenie nie miało pozycji pełnowartościowych (samo zniszczenie). */
  mmNumer: string;
  /** Numer RW; brak = zlecenie nie miało pozycji zniszczonych. */
  rwNumer?: string;
}

/**
 * Typy zadań kolejki, które wykonuje WORKER SFERY (proces C#), a nie worker
 * Node. Jedna lista dla obu stron: `pickTask` w Node ma ich nie dotykać przy
 * SFERA_WORKER=1, a `sfera-worker/sql/*.sql` bierze dokładnie te same.
 */
export const TYPY_SFERY = ["mm"] as const;

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
   * Dopisz zdjęcie do kartoteki — `tw_ZdjecieTw` (0.88.0).
   *
   * TRZECIE i najdalej idące rozszerzenie granicy zapisu: pierwsze, które
   * DODAJE WIERSZ, a nie zmienia jednej kolumny istniejącego. Do 0.87.0
   * `docs/subiekt-gt-struktura.md` opisywał zdjęcia jako wyłącznie do odczytu.
   *
   * Powód jest ten sam co przy kodzie kreskowym: magazynier stoi przy regale
   * z towarem, którego kartoteka nie ma zdjęcia, i nie ma czym tego naprawić.
   *
   * Zadanie zna sam `twId` — bajty leżą w `zdjecie_wlasne`. Kolumna `payload`
   * kolejki jest czytana przy każdym obrocie pętli workera i 300 kB w niej to
   * 300 kB odczytu co sekundę.
   */
  applySetZdjecie(twId: number): Promise<void>;
  /**
   * Utwórz dokument MM (magazyn źródłowy → docelowy), przesuń pozycje,
   * zwróć numer dokumentu MM (spec §5.3 / §9).
   */
  createMM(magFrom: number, magTo: number, items: MmItem[]): Promise<string>;
  /**
   * Korekta dokumentu sprzedaży ORAZ MM na bufor zwrotowy — atomowo.
   *
   * „Atomowo" znaczy tu: gdy MM się nie uda, korekta zostaje USUNIĘTA, a całe
   * zadanie kończy się błędem. Subiekt nie ma transakcji obejmującej dwa
   * dokumenty, więc nie ma innej drogi niż wycofanie ręką implementacji —
   * i dlatego to JEDNA metoda, a nie dwa zadania kolejki.
   */
}
