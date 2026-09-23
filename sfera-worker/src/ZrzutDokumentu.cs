using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;

namespace WertisSferaWorker;

/* ── Zrzut pól dokumentu przy odmowie zapisu (0.456.0) ────────────────────────
   Wywiad z właścicielem, 23 września 2026: najwięcej czasu przy zwrotach zjada
   ZW odrzucany przez Sferę zdaniem „Nie można zapisać dokumentu" (0x80040F20).
   Pytanie „uruchomisz sondę z komunikatu i odeślesz wynik?" dostało odpowiedź
   „niech robi to sam".

   Dwie hipotezy czekają na pomiar (docs/sfera-com.md §2m): suma form płatności
   rozjechana z kwotą do zapłaty — szkic dziedziczy płatność z paragonu, a worker
   ustawia tylko przelew — i pusty nabywca, którego worker nie ustawia nigdy.
   Obie mierzy sonda `-SzkicZW -Sprawdz`, ale wymaga to człowieka przy serwerze
   w chwili, gdy zadanie już padło. Ten plik robi TEN SAM odczyt w chwili odmowy,
   na tym samym obiekcie, który nie przeszedł.

   NAZW NIE ZGADUJEMY. Sonda wylicza właściwości przez `Get-Member`, czyli przez
   informację o typie z IDispatch. Tu idzie ta sama droga (`ITypeInfo`), więc
   zrzut zobaczy pola, których nazw nikt jeszcze nie zapisał w dokumentacji —
   a właśnie tam może siedzieć druga forma płatności.

   PRYWATNOŚĆ JAK W SONDZIE. Pola nabywcy, adresu i rachunku dostają WYŁĄCZNIE
   „puste" albo „wypełnione". Treść błędu idzie do kolejki, na ekran panelu
   i do dziennika, a adres dostawy nie ma prawa stąd wyjść. Wzorzec jest tym
   samym `$prywatne` z `sonda.ps1`, plus rachunek.

   NIE WYWRACA WOŁAJĄCEGO. Jesteśmy już w obsłudze odmowy — każdy własny wyjątek
   zamienia się w zdanie w nawiasie, bo druga awaria zasłoniłaby pierwszą. */

[SupportedOSPlatform("windows")]
internal static class ZrzutDokumentu
{
    /** Pola, których WARTOŚCI trafiają do zrzutu — płatność, kwoty, rodzaj. */
    private static readonly Regex Pola = new(
        "Plat|Zaplac|Przelew|Gotow|Kart|Kredyt|Przedplat|Kwota|Wartosc|Rodzaj|Skutek|Kasa|Waluta|Termin",
        RegexOptions.IgnoreCase);

    /** Pola, o których mówimy tylko „puste/wypełnione" — lustro `$prywatne`. */
    private static readonly Regex Prywatne = new(
        "Kontrahent|Nabywca|Odbiorca|Adres|Nip|Pesel|Telefon|Email|Mail|Uwagi|Opis|Osoba|Imie|Nazwisko|Bank|Konto|Rachun",
        RegexOptions.IgnoreCase);

    /** Górna granica długości — treść błędu ląduje w jednym wierszu kolejki. */
    private const int MaksZnakow = 1800;

    /* IDispatch widziany tylko do `GetTypeInfo`. Kolejność metod jest kolejnością
       w tablicy wirtualnej IDispatch, więc deklaracja kończy się na drugiej —
       `GetIDsOfNames` i `Invoke` nie są tu potrzebne. */
    [ComImport, Guid("00020400-0000-0000-C000-000000000046"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDispatchTypu
    {
        [PreserveSig] int GetTypeInfoCount(out uint ile);
        [PreserveSig] int GetTypeInfo(uint indeks, int lcid,
            [MarshalAs(UnmanagedType.Interface)] out ITypeInfo? info);
    }

    /**
     * Jedna linijka do treści błędu: „pola: A=1; B=2 · nabywca/rachunek: X puste".
     */
    public static string Opis(object dokument)
    {
        List<string> nazwy;
        try { nazwy = NazwyWlasciwosci(dokument); }
        catch (Exception e) { return $"(zrzut pól niedostępny: {e.Message.Trim()})"; }
        if (nazwy.Count == 0) return "(zrzut pól niedostępny: obiekt nie podał informacji o typie)";

        var wartosci = new List<string>();
        var prywatne = new List<string>();
        foreach (string n in nazwy)
        {
            if (Prywatne.IsMatch(n))
                prywatne.Add($"{n} {(CzyPuste(dokument, n) ? "puste" : "wypełnione")}");
            else if (Pola.IsMatch(n))
                wartosci.Add($"{n}={Wartosc(dokument, n)}");
        }

        string wynik = $"pola: {(wartosci.Count > 0 ? string.Join("; ", wartosci) : "(żadne nie pasuje)")}";
        if (prywatne.Count > 0) wynik += $" · nabywca/rachunek: {string.Join(", ", prywatne)}";
        return wynik.Length <= MaksZnakow ? wynik : wynik[..MaksZnakow] + "…";
    }

    /**
     * Nazwy właściwości bez argumentów — funkcje `INVOKE_PROPERTYGET` i zmienne
     * interfejsu. Dispinterface opisuje właściwości RAZ jako funkcje, raz jako
     * zmienne, zależnie od tego, jak zbudowano bibliotekę typów; bierzemy oba.
     */
    private static List<string> NazwyWlasciwosci(object com)
    {
        var wynik = new List<string>();
        if (com is not IDispatchTypu dispatch) return wynik;
        if (dispatch.GetTypeInfo(0, 0, out ITypeInfo? info) != 0 || info is null) return wynik;

        info.GetTypeAttr(out IntPtr wskAttr);
        try
        {
            TYPEATTR attr = Marshal.PtrToStructure<TYPEATTR>(wskAttr);
            for (int i = 0; i < attr.cFuncs; i++)
            {
                info.GetFuncDesc(i, out IntPtr wskFunc);
                try
                {
                    FUNCDESC f = Marshal.PtrToStructure<FUNCDESC>(wskFunc);
                    if (f.invkind == INVOKEKIND.INVOKE_PROPERTYGET && f.cParams == 0)
                        Dodaj(info, f.memid, wynik);
                }
                finally { info.ReleaseFuncDesc(wskFunc); }
            }
            for (int i = 0; i < attr.cVars; i++)
            {
                info.GetVarDesc(i, out IntPtr wskVar);
                try
                {
                    VARDESC v = Marshal.PtrToStructure<VARDESC>(wskVar);
                    Dodaj(info, v.memid, wynik);
                }
                finally { info.ReleaseVarDesc(wskVar); }
            }
        }
        finally { info.ReleaseTypeAttr(wskAttr); }
        return wynik;
    }

    private static void Dodaj(ITypeInfo info, int memid, List<string> wynik)
    {
        var nazwy = new string[1];
        info.GetNames(memid, nazwy, 1, out int ile);
        if (ile > 0 && !string.IsNullOrEmpty(nazwy[0]) && !wynik.Contains(nazwy[0]))
            wynik.Add(nazwy[0]);
    }

    /** Odczyt przez IDispatch — ta sama droga co `ElementZIndeksem` w adapterze. */
    private static object? Pobierz(object com, string nazwa) =>
        com.GetType().InvokeMember(nazwa, BindingFlags.GetProperty, null, com, null);

    /** Wartość do zdania; odmowa odczytu zostaje zdaniem, nie wyjątkiem. */
    private static string Wartosc(object com, string nazwa)
    {
        try
        {
            object? w = Pobierz(com, nazwa);
            if (w is null) return "(null)";
            /* Obiekt COM zamiast liczby to podobiekt (kasa, waluta) — jego
               zawartość nie mieści się w zdaniu, więc mówimy tylko, że jest. */
            if (Marshal.IsComObject(w)) return "(obiekt)";
            string tekst = (Convert.ToString(w, System.Globalization.CultureInfo.InvariantCulture) ?? "").Trim();
            return tekst.Length > 0 ? tekst : "(puste)";
        }
        catch (Exception e)
        {
            return $"(odmowa: {(e.InnerException ?? e).Message.Trim()})";
        }
    }

    /**
     * „Puste" jak w sondzie: null, pusty napis albo zero. Wartość NIE opuszcza
     * tej funkcji — to jest cała gwarancja prywatności tego pliku.
     */
    private static bool CzyPuste(object com, string nazwa)
    {
        try
        {
            object? w = Pobierz(com, nazwa);
            if (w is null) return true;
            if (Marshal.IsComObject(w)) return false;
            string tekst = (Convert.ToString(w, System.Globalization.CultureInfo.InvariantCulture) ?? "").Trim();
            return tekst.Length == 0 || tekst == "0";
        }
        catch
        {
            /* Pole, którego nie da się odczytać, nie jest „wypełnione" —
               ale nie wiemy też, że jest puste. Odmowę liczymy jako pustkę,
               bo zapis Sfery i tak nie zobaczy z niego wartości. */
            return true;
        }
    }
}
