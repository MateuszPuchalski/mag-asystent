namespace WertisSferaWorker;

/* Przebieg próbny pętli BEZ Sfery (flaga --dry-run): zadanie przechodzi cały
   cykl pick → processing → done z fikcyjnym numerem dokumentu, więc heartbeat,
   guard kolejności, audyt i zapis zwrotny da się obejrzeć na maszynie bez
   licencji — także na Linuksie. ŻADEN dokument nie powstaje.

   Fikcyjny numer mówi to wprost — trafia do sgt_doc_number i na ekran kolejki,
   więc nie może udawać prawdziwego MM. */
public sealed class DryRunAdapter : ISferaAdapter
{
    private int _licznik;

    public string CreateMM(int magFrom, int magTo, IReadOnlyList<MmItem> items)
    {
        _licznik++;
        Console.WriteLine(
            $"[sfera] DRY-RUN: MM {magFrom}->{magTo}, pozycji {items.Count} — dokument NIE powstaje");
        return $"MM DRY-RUN/{_licznik}";
    }

    public WynikKorekty CreateKorektaZwrotu(ZlecenieKorekty z)
    {
        _licznik++;
        Console.WriteLine(
            $"[sfera] DRY-RUN: korekta {z.Typ} do dok. {z.DokId} + MM {z.MagZrodlowy}->{z.MagZwrotow}, " +
            $"pozycji {z.Pozycje.Count}, zniszczonych {z.PozycjeZniszczone.Count} — dokumenty NIE powstają");
        return new WynikKorekty(
            $"K{z.Typ} DRY-RUN/{_licznik}",
            z.Pozycje.Count > 0 ? $"MM DRY-RUN/{_licznik}" : "",
            z.PozycjeZniszczone.Count > 0 ? $"RW DRY-RUN/{_licznik}" : "");
    }
}
