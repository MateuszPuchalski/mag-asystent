/**
 * SferaAdapter — granica ZAPISU do Subiekta GT (spec §9).
 * Worker jest jedynym miejscem, które go używa; kolektor nigdy nie czeka
 * synchronicznie na COM (spec §12).
 *
 * DEV: mutacja tabel sgt_* (sfera.dev.ts) — realna zmiana stanu w read-modelu.
 * PROD: COM/Sfera na Windows (sfera.com.ts) — Towary.Wczytaj/Zapisz, dokument MM.
 */
export interface MmItem {
  twId: number;
  qty: number;
}

export interface SferaAdapter {
  /** Ustaw pole lokalizacji na kartotece towaru (spec §5.2). */
  applySetLocation(twId: number, newValue: string): Promise<void>;
  /**
   * Utwórz dokument MM (magazyn źródłowy → docelowy), przesuń pozycje,
   * zwróć numer dokumentu MM (spec §5.3 / §9).
   */
  createMM(magFrom: number, magTo: number, items: MmItem[]): Promise<string>;
}
