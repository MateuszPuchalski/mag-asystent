namespace WertisSferaWorker;

/// <summary>Pozycja dokumentu MM — lustro MmItem z server/src/adapters/sfera.ts.</summary>
public sealed record MmItem(int TwId, double Qty);

/// <summary>
/// Zlecenie korekty zwrotu — lustro ZlecenieKorekty z sfera.ts.
/// PozycjeZniszczone (0.67.0): wchodzą na korektę razem z Pozycje, ale zamiast
/// MM na bufor od razu schodzą dokumentem RW z magazynu sprzedaży. Pusta lista
/// = zadanie sprzed 0.67.0 albo zwrot bez zniszczeń.
/// </summary>
public sealed record ZlecenieKorekty(
    int DokId, string Typ, int MagZrodlowy, int MagZwrotow,
    IReadOnlyList<MmItem> Pozycje, IReadOnlyList<MmItem> PozycjeZniszczone);

/// <summary>Numery dokumentów — lustro WynikKorekty z sfera.ts.
/// MmNumer/RwNumer puste, gdy odpowiedni dokument nie był potrzebny.</summary>
public sealed record WynikKorekty(string KorektaNumer, string MmNumer, string RwNumer = "");

/// <summary>
/// Zlecenie ZW do paragonu (0.349.0) — lustro ZlecenieZw z sfera.ts.
/// Pozycje są już zsumowane po kartotece i rozbite z kompletów po stronie
/// serwera; WartoscGrosze to PEŁNA wartość zwrotu, bez potrąceń.
/// </summary>
public sealed record ZlecenieZw(
    int DokId, IReadOnlyList<MmItem> Pozycje, int PrzesylkaTwId, bool PrzesylkaZostaw,
    long WartoscGrosze);

/// <summary>
/// Dokument źródłowy otwarty w Subiekcie przez kogoś innego (0.349.0).
/// To NIE jest błąd zadania: biuro ma paragon na ekranie. Kolejka odkłada
/// zadanie bez zużycia próby — trzy próby w dwie minuty skończyłyby się
/// błędem w chwili, gdy biuro jeszcze patrzy na paragon.
/// </summary>
public sealed class DokumentZablokowanyException : Exception
{
    public DokumentZablokowanyException(string message) : base(message) { }
}

/// <summary>
/// Odmowa, której ponowienie nie zmieni (0.349.0): rozjazd wartości, brak
/// wiersza na paragonie, ZW bez skutku magazynowego. Kolejka od razu
/// oznacza błąd — trzy identyczne próby opóźniłyby tylko biuro.
/// </summary>
public sealed class BladTrwalyException : Exception
{
    public BladTrwalyException(string message) : base(message) { }
}

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

    /// <summary>
    /// ZW do paragonu (0.349.0) — sam dokument, bez MM: towar przesuwa koszyk
    /// zwrotów, który czeka na ten numer. Zwraca pełny numer ZW.
    /// </summary>
    string CreateZw(ZlecenieZw zlecenie);
}
