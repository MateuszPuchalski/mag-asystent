namespace WertisSferaWorker;

/// <summary>Pozycja dokumentu MM — lustro MmItem z server/src/adapters/sfera.ts.</summary>
public sealed record MmItem(int TwId, double Qty);

/* Granica ZAPISU MM do Subiekta — odpowiednik SferaAdapter.createMM
   z server/src/adapters/sfera.ts, zawężony do jedynej operacji tego procesu.
   set_location zostaje w workerze Node (bezpośredni UPDATE jednej kolumny),
   bo do niego Sfera nie jest potrzebna. */
public interface ISferaAdapter
{
    /// <summary>
    /// Utwórz dokument MM (magazyn źródłowy → docelowy), przesuń pozycje,
    /// zwróć pełny numer dokumentu (→ sfera_queue.sgt_doc_number).
    /// </summary>
    string CreateMM(int magFrom, int magTo, IReadOnlyList<MmItem> items);
}
