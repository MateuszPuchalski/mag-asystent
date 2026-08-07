using System.Runtime.InteropServices;

namespace WertisSferaWorker;

/* ── Zapis MM przez COM Sfery — KAŻDE wywołanie COM to [WERYFIKUJ] ───────────
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
            var su = Sesja();
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
            return (string)mm.NumerPelny;                 // [WERYFIKUJ] → sgt_doc_number
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
