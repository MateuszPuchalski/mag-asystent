using System.Runtime.InteropServices;

namespace WertisSferaWorker;

/* ── Zapis dokumentów przez COM Sfery — KAŻDE wywołanie COM to [WERYFIKUJ] ───
   Ten plik jest jedynym miejscem, które rozmawia ze Sferą, i JEDYNYM plikiem,
   który trzeba poprawić po ustaleniach na maszynie testowej. Szkic wywołań
   pochodzi z kontraktu w server/src/adapters/sfera.ts; nazwy ProgID, właściwości
   i metod NIE są zweryfikowane na żywej Sferze — stąd znaczniki [WERYFIKUJ]
   (konwencja repo: wartość do potwierdzenia na własnym systemie, DEPLOY §6).

   Late binding (`dynamic` + GetTypeFromProgID) zamiast interop DLL: kompiluje
   się bez Subiekta na maszynie (także w CI na Linuksie), a wersja biblioteki
   Sfery nie jest wtedy zaszyta w exe.

   Sekwencyjność: COM Sfery nie jest thread-safe (spec §9) — proces przetwarza
   jedno zadanie naraz w jednym wątku STA (Program.Main ma [STAThread]),
   więc ta klasa nie potrzebuje żadnej własnej synchronizacji.

   Sesja Subiekta jest otwierana raz i trzymana między zadaniami (start Sfery
   to sekundy, a MM przychodzą seriami przy kontenerze). Po wyjątku COM sesja
   idzie do kosza i następne zadanie otwiera ją od nowa — wiszący uchwyt COM
   to najczęstsza awaria Sfery i restart sesji jest tańszy niż diagnoza. */

public sealed class SferaComAdapter : ISferaAdapter
{
    private readonly EnvFile _env;
    private dynamic? _subiekt;

    public SferaComAdapter(EnvFile env) => _env = env;

    public string CreateMM(int magFrom, int magTo, IReadOnlyList<MmItem> items)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException(
                "COM Sfery działa wyłącznie na Windows z zainstalowanym Subiektem GT. " +
                "Do przebiegu próbnego bez Sfery służy flaga --dry-run.");

        try
        {
            return DodajMm(Sesja(), magFrom, magTo, items).Numer;
        }
        catch
        {
            ZamknijSesje();
            throw;
        }
    }

    /// <summary>
    /// MM jako (dokument, numer) — korekta zwrotu potrzebuje UCHWYTU, żeby móc
    /// wycofać MM, gdy padnie RW stojące dalej w łańcuchu.
    /// </summary>
    private static (dynamic Dok, string Numer) DodajMm(
        dynamic su, int magFrom, int magTo, IReadOnlyList<MmItem> items)
    {
        /* [WERYFIKUJ] nazwa managera i metody — kontrakt sfera.ts podaje
           DokumentyMagazynoweManager.DodajMM(); w nowszych wersjach Sfery
           bywa SuDokumentyManager z typem dokumentu w argumencie. */
        dynamic mm = su.DokumentyMagazynoweManager.DodajMM();
        mm.MagazynZrodlowyId = magFrom;   // [WERYFIKUJ] nazwy właściwości magazynów
        mm.MagazynDocelowyId = magTo;
        foreach (var it in items)
        {
            dynamic p = mm.Pozycje.Dodaj(it.TwId);   // [WERYFIKUJ] dodawanie pozycji po tw_Id
            p.IloscJm = it.Qty;
        }
        /* Decyzja domyślna: MM powstaje WYKONANE, nie w buforze — sens
           operacji to „towar sprzedawalny na hali". [WERYFIKUJ] na etapie 2
           (docs/wdrozenie.md); jeśli firma woli bufor, tu jest to jedno
           wywołanie do zmiany. */
        mm.Zapisz();                                  // [WERYFIKUJ]
        return (mm, (string)mm.NumerPelny);           // [WERYFIKUJ] → sgt_doc_number
    }

    /// <summary>
    /// RW dla pozycji zniszczonych (0.67.0) — rozchód z magazynu sprzedaży,
    /// zaraz po korekcie, która te sztuki na stan oddała.
    /// </summary>
    private static string DodajRw(dynamic su, int magId, IReadOnlyList<MmItem> items)
    {
        /* [WERYFIKUJ] nazwa metody RW — kontrakt sfera.ts podaje
           DokumentyMagazynoweManager.DodajRW(); dok_Typ RW = 13. */
        dynamic rw = su.DokumentyMagazynoweManager.DodajRW();
        rw.MagazynId = magId;                         // [WERYFIKUJ] właściwość magazynu RW
        foreach (var it in items)
        {
            dynamic p = rw.Pozycje.Dodaj(it.TwId);    // [WERYFIKUJ]
            p.IloscJm = it.Qty;
        }
        rw.Zapisz();                                  // [WERYFIKUJ]
        return (string)rw.NumerPelny;                 // [WERYFIKUJ]
    }

    public WynikKorekty CreateKorektaZwrotu(ZlecenieKorekty z)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException(
                "COM Sfery działa wyłącznie na Windows z zainstalowanym Subiektem GT. " +
                "Do przebiegu próbnego bez Sfery służy flaga --dry-run.");

        try
        {
            var su = Sesja();
            /* [WERYFIKUJ] wystawienie korekty do istniejącego dokumentu —
               kontrakt sfera.ts podaje DokumentyHandloweManager.DodajKorekte(dokId);
               nazwa managera i metody zależy od wersji Sfery. */
            dynamic korekta = su.DokumentyHandloweManager.DodajKorekte(z.DokId);
            foreach (var it in z.Pozycje.Concat(z.PozycjeZniszczone))
            {
                /* [WERYFIKUJ] adresowanie pozycji korekty. Korekta w Subiekcie
                   nie DODAJE wierszy — zmienia ilość po korekcie na wierszach
                   dokumentu pierwotnego, więc pozycję trzeba ODNALEŹĆ po tw_Id.
                   Zniszczone wchodzą na korektę RAZEM z pełnowartościowymi:
                   klient oddał towar, sprzedaż koryguje się w całości. */
                dynamic p = korekta.Pozycje.SzukajTowar(it.TwId);
                p.IloscPoKorekcie = p.Ilosc - it.Qty;
            }
            korekta.Zapisz();                                 // [WERYFIKUJ]
            string nrKorekty = (string)korekta.NumerPelny;    // [WERYFIKUJ]

            /* Dalsze ogniwa TEJ SAMEJ operacji: MM (pełnowartościowe → bufor)
               i RW (zniszczone schodzą ze stanu). Gdy którekolwiek padnie,
               wszystko przed nim MUSI zniknąć: korekta bez MM zostawia towar
               sprzedawalny w magazynie sprzedaży, korekta+MM bez RW zostawia
               zniszczone sztuki na stanie jako duchy. */
            dynamic? mmDok = null;
            string nrMm = "";
            try
            {
                if (z.Pozycje.Count > 0)
                    (mmDok, nrMm) = DodajMm(su, z.MagZrodlowy, z.MagZwrotow, z.Pozycje);
                string nrRw = z.PozycjeZniszczone.Count > 0
                    ? DodajRw(su, z.MagZrodlowy, z.PozycjeZniszczone)
                    : "";
                return new WynikKorekty(nrKorekty, nrMm, nrRw);
            }
            catch (Exception blad)
            {
                /* Wycofanie idzie od końca łańcucha; każdy nieusunięty dokument
                   trafia do komunikatu z IMIENIA, bo to jego człowiek będzie
                   musiał usunąć ręką przed ponowieniem. */
                var nieWycofane = new List<string>();
                if (mmDok is not null)
                {
                    try { mmDok.Usun(); }                     // [WERYFIKUJ]
                    catch { nieWycofane.Add($"MM {nrMm}"); }
                }
                try { korekta.Usun(); }                       // [WERYFIKUJ]
                catch { nieWycofane.Add($"korekta {nrKorekty}"); }

                throw nieWycofane.Count == 0
                    ? new InvalidOperationException(
                        $"Dokumenty zwrotu nie powstały w całości — korekta {nrKorekty}" +
                        (nrMm.Length > 0 ? $" i MM {nrMm}" : "") +
                        $" zostały wycofane, PONÓW jest bezpieczny. Przyczyna: {blad.Message}", blad)
                    : new InvalidOperationException(
                        $"Dokumenty zwrotu nie powstały w całości, a wycofanie NIE OBJĘŁO: " +
                        $"{string.Join(", ", nieWycofane)} — usuń je w Subiekcie RĘCZNIE przed " +
                        $"ponowieniem. Przyczyna: {blad.Message}", blad);
            }
        }
        catch
        {
            ZamknijSesje();
            throw;
        }
    }

    private dynamic Sesja()
    {
        if (_subiekt is not null) return _subiekt;

        /* [WERYFIKUJ] ProgID obiektu GT — wg dokumentacji Sfery "InsERT.GT". */
        var typ = Type.GetTypeFromProgID("InsERT.GT")
            ?? throw new InvalidOperationException(
                "Nie znaleziono COM \"InsERT.GT\" — czy Subiekt GT (ze Sferą) jest zainstalowany na tej maszynie?");
        dynamic gt = Activator.CreateInstance(typ)!;

        /* [WERYFIKUJ] wyliczenia i logowanie — wartości wg dokumentacji Sfery:
           Produkt = gtaProduktSubiekt (1), Autentykacja wg mechanizmu firmy
           (operator/hasło albo Windows). Serwer i baza jak w wertis.env —
           te same, które czyta API. */
        gt.Produkt = 1;                                   // gtaProduktSubiekt [WERYFIKUJ]
        gt.Serwer = _env.Get("MSSQL_SERVER", "localhost");
        gt.Baza = _env.Get("MSSQL_DATABASE", "");
        gt.Autentykacja = 0;                              // [WERYFIKUJ] 0=mieszana/SQL?
        gt.Operator = _env.Get("SFERA_OPERATOR", "");
        gt.OperatorHaslo = _env.Get("SFERA_OPERATOR_HASLO", "");

        /* [WERYFIKUJ] tryb uruchomienia: gtaUruchomDopasuj / w tle, bez okna. */
        _subiekt = gt.Uruchom(0, 4);
        Console.WriteLine("[sfera] sesja Subiekta otwarta (Sfera COM)");
        return _subiekt!;
    }

    private void ZamknijSesje()
    {
        if (_subiekt is null) return;
        try
        {
            if (OperatingSystem.IsWindows()) Marshal.ReleaseComObject(_subiekt);
        }
        catch
        {
            // zwalnianie martwego uchwytu COM nie ma prawa ubić procesu
        }
        _subiekt = null;
        Console.WriteLine("[sfera] sesja Subiekta zamknięta po błędzie — następne zadanie otworzy nową");
    }
}
