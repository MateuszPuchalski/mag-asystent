namespace WertisSferaWorker;

/// <summary>Pozycja dokumentu MM — lustro MmItem z server/src/adapters/sfera.ts.</summary>
public sealed record MmItem(int TwId, double Qty);

/// <summary>Zlecenie korekty zwrotu — lustro ZlecenieKorekty z sfera.ts.</summary>
public sealed record ZlecenieKorekty(
    int DokId, string Typ, int MagZrodlowy, int MagZwrotow, IReadOnlyList<MmItem> Pozycje);

/// <summary>Numery obu dokumentów — lustro WynikKorekty z sfera.ts.</summary>
public sealed record WynikKorekty(string KorektaNumer, string MmNumer);

/* Granica ZAPISU DOKUMENTÓW do Subiekta — odpowiednik SferaAdapter
   z server/src/adapters/sfera.ts, zawężony do operacji tego procesu.
   set_location zostaje w workerze Node (bezpośredni UPDATE jednej kolumny),
   bo do niego Sfera nie jest potrzebna. */
public interface ISferaAdapter
{
    /// <summary>
    /// Utwórz dokument MM (magazyn źródłowy → docelowy), przesuń pozycje,
    /// zwróć pełny numer dokumentu (→ sfera_queue.sgt_doc_number).
    /// </summary>
    string CreateMM(int magFrom, int magTo, IReadOnlyList<MmItem> items);

    /// <summary>
    /// Korekta dokumentu sprzedaży ORAZ MM na bufor zwrotowy — atomowo.
    /// Gdy MM padnie, korekta MUSI zostać usunięta: Subiekt nie ma transakcji
    /// obejmującej dwa dokumenty, więc wycofanie jest zadaniem implementacji.
    /// </summary>
    WynikKorekty CreateKorektaZwrotu(ZlecenieKorekty zlecenie);
}
