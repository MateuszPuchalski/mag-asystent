using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using SkiaSharp;

namespace WertisTloWorker;

/* ── Model i całe jego otoczenie ─────────────────────────────────────────────
   JEDEN PLIK NA MODEL — ta sama konwencja co `SferaComAdapter.cs` dla COM
   i `adapters/zdjecia.sgt.ts` dla źródła zdjęć. Podmiana modelu (u2netp → isnet
   → cokolwiek nowszego) ma dotykać tego pliku i nazwy pliku .onnx, a nie HTTP,
   przetwarzania obrazu ani niczego po stronie serwera.

   MODEL NIE LEŻY W REPOZYTORIUM. Tak samo jak AAR Honeywella: plik binarny
   kilku megabajtów, którego nie da się sensownie przeglądać ani różnicować.
   Pobiera go `build.ps1`, adres i suma kontrolna stoją w README.

   USTALONE 22.08.2026 na pobranym pliku (u2netp.onnx, sha256 309c8469…f4ddd8):
     1. Wejście nazywa się `input.1`, NIE `input`, kształt 1×3×320×320 NCHW
        float32. Nazwy NIE wpisujemy na sztywno — bierzemy ją z metadanych
        sesji, więc podmiana modelu na isnet nie wymaga tu zmiany.
     2. Wyjść jest SIEDEM (d0…d6). Pierwsze ma kształt 1×1×320×320 i to ono
        jest maską; rembg bierze dokładnie to samo (`ort_outs[0][:, 0]`).
     3. Sigmoida JEST w grafie — siedem operacji `Sigmoid` na jego końcu, po
        jednej na wyjście. Wartości przychodzą więc już z zakresu 0…1.        */

public sealed class UsuwanieTla : IDisposable
{
    /// <summary>Bok wejścia modelu. u2netp i isnet-general-use używają 320.</summary>
    private const int BokModelu = 320;

    /* Normalizacja z oryginalnego U²-Net: najpierw dzielenie przez maksimum
       kanału, potem statystyki ImageNet. Przepisane z `rembg` — inne wartości
       nie wywalają modelu, tylko cicho psują maskę, więc to jest miejsce,
       w którym „prawie" nie wystarcza. */
    private static readonly float[] Srednia = { 0.485f, 0.456f, 0.406f };
    private static readonly float[] Odchylenie = { 0.229f, 0.224f, 0.225f };

    private readonly InferenceSession _sesja;
    private readonly string _wejscie;

    public UsuwanieTla(string sciezkaModelu)
    {
        if (!File.Exists(sciezkaModelu))
        {
            throw new FileNotFoundException(
                $"Nie ma pliku modelu {sciezkaModelu}. Pobierz go poleceniem z tlo-worker/README.md " +
                "albo wskaż inny plik zmienną TLO_MODEL w wertis.env.",
                sciezkaModelu);
        }
        _sesja = new InferenceSession(sciezkaModelu);
        _wejscie = _sesja.InputMetadata.Keys.First();
    }

    /// <summary>
    /// Zdjęcie bez tła — PNG z przezroczystością — albo <c>null</c>, gdy model
    /// nie znalazł na kadrze przedmiotu.
    ///
    /// <c>null</c> to ODPOWIEDŹ, nie awaria: zdjęcie regału z pięcioma kartonami
    /// wygląda dokładnie tak. Wołający zamienia je na 422, a człowiek przy regale
    /// widzi oryginał i przycisk „ZOSTAW TŁO".
    /// </summary>
    public byte[]? Przetworz(byte[] wejscie, int bokWyniku)
    {
        using var zrodlo = Obraz.Dekoduj(wejscie)
            ?? throw new InvalidOperationException("To nie jest obraz, który da się odczytać.");

        using var kwadrat = Obraz.DoKwadratu(zrodlo, BokModelu);
        var maska = Maska(kwadrat);
        using var zAlfa = Obraz.ZAlfa(zrodlo, maska, BokModelu);

        var ramka = Obraz.RamkaWidoczna(zAlfa);
        if (ramka is null) return null;

        /* Maska obejmująca prawie CAŁY kadr znaczy to samo co maska pusta:
           model nie wydzielił przedmiotu, tylko oddał zdjęcie. Wycięcie tła,
           które niczego nie wycięło, byłoby obietnicą bez pokrycia — lepiej
           powiedzieć wprost, że się nie udało. */
        var udzial = (double)ramka.Value.Width * ramka.Value.Height / (zrodlo.Width * (double)zrodlo.Height);
        if (udzial > 0.995) return null;

        using var gotowe = Obraz.PrzytnijISkaluj(zAlfa, ramka.Value, bokWyniku);
        return Obraz.DoPng(gotowe);
    }

    private float[] Maska(SKBitmap kwadrat)
    {
        var piksele = BokModelu * BokModelu;
        var wejscie = new DenseTensor<float>(new[] { 1, 3, BokModelu, BokModelu });

        /* `im / np.max(im)` z rembg. Maksimum liczymy po WSZYSTKICH kanałach
           razem, nie osobno — inaczej zdjęcie z jednym nasyconym kanałem
           zmieniałoby barwy przed wejściem do modelu. */
        var pikseleWejscia = kwadrat.Pixels;
        byte maks = 1;
        foreach (var p in pikseleWejscia)
        {
            maks = Math.Max(maks, Math.Max(p.Red, Math.Max(p.Green, p.Blue)));
        }

        for (var y = 0; y < BokModelu; y++)
        {
            for (var x = 0; x < BokModelu; x++)
            {
                var p = pikseleWejscia[y * BokModelu + x];
                wejscie[0, 0, y, x] = (p.Red / (float)maks - Srednia[0]) / Odchylenie[0];
                wejscie[0, 1, y, x] = (p.Green / (float)maks - Srednia[1]) / Odchylenie[1];
                wejscie[0, 2, y, x] = (p.Blue / (float)maks - Srednia[2]) / Odchylenie[2];
            }
        }

        using var wynik = _sesja.Run(
            new[] { NamedOnnxValue.CreateFromTensor(_wejscie, wejscie) });
        // PIERWSZE wyjście: U²-Net oddaje siedem map, reszta to wyjścia pośrednie.
        var surowa = wynik.First().AsEnumerable<float>().Take(piksele).ToArray();

        /* Rozciągnięcie min–max, tak jak w rembg. Bez niego maska bywa cała
           w okolicach 0,4 i po progu alfy nie zostaje z przedmiotu nic. */
        var min = surowa.Min();
        var maksM = surowa.Max();
        var zakres = maksM - min;
        if (zakres < 1e-6f) return new float[piksele];
        for (var i = 0; i < piksele; i++) surowa[i] = (surowa[i] - min) / zakres;
        return surowa;
    }

    public void Dispose() => _sesja.Dispose();
}
