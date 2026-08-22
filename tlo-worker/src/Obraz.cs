using SkiaSharp;

namespace WertisTloWorker;

/* ── Obraz: dekodowanie, maska w kanale alfa, przycięcie, skalowanie ─────────
   CAŁA praca na pikselach siedzi w tym pliku; `UsuwanieTla.cs` zna model,
   `Program.cs` zna HTTP. Podział ten sam co po stronie serwera, gdzie źródło
   zdjęć, cache i trasa też są trzema osobnymi plikami.

   PRZYCIĘCIE DO WIDOCZNEJ TREŚCI jest tu regułą przeniesioną wprost z panelu
   biura i kolektora: `ramkaWidoczna` w `server/src/web/biuro.html` i w
   `android/core/.../delivery/LogoRamka.kt` robią to samo dla logo dostawcy,
   z tym samym progiem alfy. Powód też jest ten sam: obraz z szerokim
   przezroczystym marginesem kolektor skaluje RAZEM z marginesem, więc przedmiot
   robi się mały, a slot wygląda na pusty w dwóch trzecich.

   Piksele czytamy TABLICĄ (`SKBitmap.Pixels`), nie `GetPixel` w pętli. Zdjęcie
   z kolektora ma ~1600 px boku, czyli około dwóch milionów pikseli — dwa
   miliony wywołań przez granicę zarządzanego kodu to sekundy, a człowiek stoi
   w tym czasie przy regale i patrzy w kółko.                                  */

public static class Obraz
{
    /// <summary>Poniżej tej alfy piksel jest pusty (0–255) — próg z LogoRamka.kt.</summary>
    private const byte ProgAlfa = 8;

    /// <summary>Bitmapa z bajtów albo null, gdy to nie jest obraz, który Skia zna.</summary>
    public static SKBitmap? Dekoduj(byte[] bajty) => SKBitmap.Decode(bajty);

    /// <summary>
    /// Kopia obrazu rozciągnięta do kwadratu <paramref name="bok"/> — wejście modelu.
    ///
    /// ROZCIĄGNIĘTA, nie wpisana w kwadrat z marginesami: tak robi `rembg`,
    /// a model widział w treningu dokładnie takie wejście.
    /// </summary>
    public static SKBitmap DoKwadratu(SKBitmap zrodlo, int bok)
    {
        var cel = new SKBitmap(bok, bok, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        using var plotno = new SKCanvas(cel);
        using var pedzel = new SKPaint { FilterQuality = SKFilterQuality.High };
        plotno.Clear(SKColors.Black);
        plotno.DrawBitmap(
            zrodlo,
            new SKRect(0, 0, zrodlo.Width, zrodlo.Height),
            new SKRect(0, 0, bok, bok),
            pedzel);
        return cel;
    }

    /// <summary>
    /// Maska (0–1, kwadrat <paramref name="bokMaski"/>) wchodzi w kanał alfa obrazu.
    ///
    /// Maskę rozciągamy Z POWROTEM na proporcje oryginału — model widział kwadrat,
    /// a zdjęcie kwadratem nie jest. Próbkowanie dwuliniowe, bo maska najbliższym
    /// sąsiadem daje na krawędzi przedmiotu schodki, a te widać na karcie.
    /// </summary>
    public static SKBitmap ZAlfa(SKBitmap zrodlo, float[] maska, int bokMaski)
    {
        var piksele = zrodlo.Pixels;
        var wynikPiksele = new SKColor[piksele.Length];
        for (var y = 0; y < zrodlo.Height; y++)
        {
            var my = (y + 0.5f) * bokMaski / zrodlo.Height - 0.5f;
            for (var x = 0; x < zrodlo.Width; x++)
            {
                var mx = (x + 0.5f) * bokMaski / zrodlo.Width - 0.5f;
                var a = (byte)Math.Clamp(Dwuliniowo(maska, bokMaski, mx, my) * 255f, 0f, 255f);
                var p = piksele[y * zrodlo.Width + x];
                wynikPiksele[y * zrodlo.Width + x] = new SKColor(p.Red, p.Green, p.Blue, a);
            }
        }
        var wynik = new SKBitmap(zrodlo.Width, zrodlo.Height, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        wynik.Pixels = wynikPiksele;
        return wynik;
    }

    private static float Dwuliniowo(float[] maska, int bok, float x, float y)
    {
        var x0 = Math.Clamp((int)MathF.Floor(x), 0, bok - 1);
        var y0 = Math.Clamp((int)MathF.Floor(y), 0, bok - 1);
        var x1 = Math.Clamp(x0 + 1, 0, bok - 1);
        var y1 = Math.Clamp(y0 + 1, 0, bok - 1);
        var fx = Math.Clamp(x - x0, 0f, 1f);
        var fy = Math.Clamp(y - y0, 0f, 1f);
        var gora = maska[y0 * bok + x0] * (1 - fx) + maska[y0 * bok + x1] * fx;
        var dol = maska[y1 * bok + x0] * (1 - fx) + maska[y1 * bok + x1] * fx;
        return gora * (1 - fy) + dol * fy;
    }

    /// <summary>
    /// Prostokąt zajęty przez widoczne piksele; <c>null</c>, gdy obraz jest cały pusty.
    ///
    /// Pusty wynik NIE jest tu błędem do przemilczenia: znaczy, że model nie
    /// znalazł na zdjęciu przedmiotu. Wołający zamienia to na odmowę 422,
    /// a człowiek przy regale dostaje zdjęcie z tłem i przycisk „ZOSTAW TŁO".
    /// </summary>
    public static SKRectI? RamkaWidoczna(SKBitmap b)
    {
        var piksele = b.Pixels;
        int x1 = b.Width, y1 = b.Height, x2 = -1, y2 = -1;
        for (var y = 0; y < b.Height; y++)
        {
            for (var x = 0; x < b.Width; x++)
            {
                if (piksele[y * b.Width + x].Alpha <= ProgAlfa) continue;
                if (x < x1) x1 = x;
                if (x > x2) x2 = x;
                if (y < y1) y1 = y;
                if (y > y2) y2 = y;
            }
        }
        return x2 < 0 ? null : new SKRectI(x1, y1, x2 + 1, y2 + 1);
    }

    /// <summary>Wycinek przeskalowany tak, żeby dłuższy bok miał <paramref name="bok"/> pikseli.</summary>
    public static SKBitmap PrzytnijISkaluj(SKBitmap zrodlo, SKRectI ramka, int bok)
    {
        var skala = MathF.Min(1f, (float)bok / Math.Max(ramka.Width, ramka.Height));
        var w = Math.Max(1, (int)MathF.Round(ramka.Width * skala));
        var h = Math.Max(1, (int)MathF.Round(ramka.Height * skala));
        var cel = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        using var plotno = new SKCanvas(cel);
        using var pedzel = new SKPaint { FilterQuality = SKFilterQuality.High };
        // BEZ wypełniania tła — po to całe to wycinanie było. Ta sama uwaga
        // co w `przeskaluj()` w biuro.html.
        plotno.Clear(SKColors.Transparent);
        plotno.DrawBitmap(
            zrodlo,
            new SKRect(ramka.Left, ramka.Top, ramka.Right, ramka.Bottom),
            new SKRect(0, 0, w, h),
            pedzel);
        return cel;
    }

    public static byte[] DoPng(SKBitmap b)
    {
        using var obraz = SKImage.FromBitmap(b);
        using var dane = obraz.Encode(SKEncodedImageFormat.Png, 100);
        return dane.ToArray();
    }
}
