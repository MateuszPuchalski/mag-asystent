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
    /**
     * Pola, których WARTOŚCI trafiają do zrzutu — TE SAME co `$polaDokumentu`
     * w sondzie (0.457.0). Do 0.456.0 worker brał węższy zestaw, bez dat,
     * numeru, typu, kategorii i magazynu. Następny krok diagnozy to zestawienie
     * zrzutu workera z `-WzorZW` na ZW, który przeszedł, a tego nie da się
     * zrobić pole w pole, gdy dwie strony patrzą na różne pola.
     */
    private static readonly Regex Pola = new(
        "Rodzaj|Zwrot|Plat|Zaplac|Przelew|Gotow|Kart|Kredyt|Przedplat|Zaliczk|Kasa|Termin|" +
        "Skutek|DoDokumentu|Typ|Kategoria|Magazyn|Wartosc|Kwota|Waluta|Data|Numer",
        RegexOptions.IgnoreCase);

    /** Pola, o których mówimy tylko „puste/wypełnione" — lustro `$prywatne`. */
    private static readonly Regex Prywatne = new(
        "Kontrahent|Nabywca|Odbiorca|Adres|Nip|Pesel|Telefon|Email|Mail|Uwagi|Opis|Osoba|Imie|Nazwisko|Bank|Konto|Rachun",
        RegexOptions.IgnoreCase);

    /**
     * Pola WIERSZA — te same co `$polaPozycji` w sondzie (0.458.0).
     *
     * Zrzut `#1481` i ZW 748/MAG/09/2026, wystawiony ręcznie do tego samego
     * paragonu, mają nagłówek identyczny pole w pole: płatność, kasa, termin,
     * nabywca, komunikat kontrahenta i wartość magazynowa. Nagłówek przestał
     * więc być podejrzany. Zostały wiersze, których zrzut do dziś nie widział.
     */
    private static readonly Regex PolaPozycji = new(
        "Towar|Ilosc|Jm|Lp|Cena|Wartosc|Rabat|Vat|Magazyn|Dostep|Oznaczenie|Akcyz|Orygin|Korekt|Rodzaj|Typ",
        RegexOptions.IgnoreCase);

    /**
     * Osobna granica dla wierszy, żeby długi paragon nie zjadł nagłówka.
     * Sześć wierszy z `#1116` po trzydzieści pól to około sześciu tysięcy znaków.
     * Od 0.462.0 dwa razy tyle, bo każdy wiersz niesie też pozostałe pola.
     */
    private const int MaksZnakowPozycji = 12000;

    /**
     * Górna granica długości — treść błędu ląduje w jednym wierszu kolejki.
     *
     * 8000, nie 4000 (0.462.0): zrzut dostał listę pozostałych pól.
     *
     * 4000, nie 1800 (0.457.0): pierwszy prawdziwy zrzut (zadanie `#1474`)
     * urwał się w środku listy pól nabywcy, a szerszy zestaw pól z sondy
     * dokłada kilkanaście pozycji. Kolumna błędu w kolejce jest tekstem bez
     * limitu, więc granica chroni tylko przed zrzutem obiektu, który ma setki
     * właściwości.
     */
    private const int MaksZnakow = 8000;

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
        var inne = new List<string>();
        foreach (string n in nazwy)
        {
            if (Prywatne.IsMatch(n))
                prywatne.Add($"{n} {(CzyPuste(dokument, n) ? "puste" : "wypełnione")}");
            else if (Pola.IsMatch(n))
                wartosci.Add($"{n}={Wartosc(dokument, n)}");
            else
                inne.Add($"{n} {StanPola(dokument, n)}");
        }

        string wynik = $"pola: {(wartosci.Count > 0 ? string.Join("; ", wartosci) : "(żadne nie pasuje)")}";
        if (prywatne.Count > 0) wynik += $" · nabywca/rachunek: {string.Join(", ", prywatne)}";
        if (inne.Count > 0) wynik += $" · pozostałe: {string.Join(", ", inne)}";
        return wynik.Length <= MaksZnakow ? wynik : wynik[..MaksZnakow] + "…";
    }

    /**
     * Wiersze dokumentu: „pozycje (2): [1] TowarId=7725; IloscJm=1 | [2] …".
     * Pola prywatne nie wchodzą wcale — w wierszu nie ma nic, czego porównanie
     * potrzebuje, a opis pozycji bywa wpisany ręcznie.
     */
    public static string OpisPozycji(object dokument)
    {
        object pozycje;
        int ile;
        try
        {
            object? p = Pobierz(dokument, "Pozycje");
            if (p is null) return "(pozycje: null)";
            pozycje = p;
            ile = Convert.ToInt32(Pobierz(pozycje, "Liczba"), System.Globalization.CultureInfo.InvariantCulture);
        }
        catch (Exception e)
        {
            return $"(pozycje niedostępne: {(e.InnerException ?? e).Message.Trim()})";
        }

        var wiersze = new List<string>();
        // `Element` liczy od jedynki — `PIERWSZA_POZYCJA` w adapterze, §2l.
        for (int i = 1; i <= ile; i++)
        {
            try
            {
                object el = pozycje.GetType().InvokeMember(
                    "Element", BindingFlags.GetProperty, null, pozycje, new object[] { i })!;
                var pola = new List<string>();
                var inne = new List<string>();
                foreach (string n in NazwyWlasciwosci(el))
                {
                    if (Prywatne.IsMatch(n)) continue;
                    if (PolaPozycji.IsMatch(n)) pola.Add($"{n}={Wartosc(el, n)}");
                    else inne.Add($"{n} {StanPola(el, n)}");
                }
                string reszta = inne.Count > 0 ? $"; pozostałe: {string.Join(", ", inne)}" : "";
                wiersze.Add($"[{i}] {(pola.Count > 0 ? string.Join("; ", pola) : "(żadne pole nie pasuje)")}{reszta}");
            }
            catch (Exception e)
            {
                wiersze.Add($"[{i}] (odmowa: {(e.InnerException ?? e).Message.Trim()})");
            }
        }
        string wynik = $"pozycje ({ile}): {string.Join(" | ", wiersze)}";
        return wynik.Length <= MaksZnakowPozycji ? wynik : wynik[..MaksZnakowPozycji] + "…";
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
     * Stan pola spoza list — „puste", „wypełnione" albo odmowa z kodem (0.462.0).
     *
     * Od 0.461.0 zrzut odmowy i ręczny ZW 748 zgadzają się w KAŻDYM polu, które
     * zrzut wypisywał — a zapis dalej odmawia. Zrzut widział jednak wyłącznie
     * pola z list `Pola` i `Prywatne`; reszty nikt nie oglądał. Wartości tych
     * pól nie wychodzą, bo nie wiemy, co niosą — mogą to być nazwisko albo
     * adres pod nazwą, której `Prywatne` nie zna. Do zestawienia wystarcza
     * stan, a odmowa zostaje odmową, bo i ona różni szkic od dokumentu.
     */
    private static string StanPola(object com, string nazwa)
    {
        try
        {
            Pobierz(com, nazwa);
        }
        catch (Exception e)
        {
            return $"odmowa 0x{(e.InnerException ?? e).HResult:X8}";
        }
        return CzyPuste(com, nazwa) ? "puste" : "wypełnione";
    }

    /**
     * „Puste": null, pusty napis, liczba równa zeru albo fałsz. Wartość NIE
     * opuszcza tej funkcji — to jest cała gwarancja prywatności tego pliku.
     *
     * ZERO TO LICZBA, NIE NAPIS (0.457.0). Do 0.456.0 stało tu porównanie
     * z napisem „0" — lustro sondy — więc kwota `0.0000` z Sfery i `False`
     * wychodziły jako „wypełnione". Pierwszy zrzut z produkcji (`#1474`)
     * pokazał przez to `PrzedplatyBankowe wypełnione`, choć w tej samej linijce
     * `PrzedplatyGotowkowe=0.0000`, a to przedpłata jest jedynym tropem płatności,
     * którego ten zrzut nie zamknął.
     */
    private static bool CzyPuste(object com, string nazwa)
    {
        try
        {
            object? w = Pobierz(com, nazwa);
            if (w is null) return true;
            if (Marshal.IsComObject(w)) return false;
            if (w is bool b) return !b;
            if (w is IConvertible && decimal.TryParse(
                    Convert.ToString(w, System.Globalization.CultureInfo.InvariantCulture),
                    System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out decimal liczba)
                && w is not string)
                return liczba == 0m;
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
