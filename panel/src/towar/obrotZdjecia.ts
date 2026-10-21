import type { Obrot } from "../zdjecia/obrobka";

/* ── Obrót zdjęcia z powiększenia ────────────────────────────────────────────
   Obrót na PŁÓTNIE do nowego adresu, nie przez `transform` w CSS. Obrócony
   w CSS obraz zajmuje w układzie miejsce nieobróconego, więc wychodziłby
   z okna, a lupa liczyłaby przybliżenie po złych osiach. Nowy plik ma
   prawdziwe wymiary i lupa działa na nim bez zmian.

   Pełna rozdzielczość, bo lupa przybliża właśnie szczegół. PNG zamiast
   JPEG, bo zdjęcie już raz skompresowane drugi raz traciłoby ostrość.
   Ten moduł woła płótno, którego jsdom nie narysuje, więc testy go
   podmieniają. */

/** Adres `blob:` z obróconym zdjęciem. Zwolnienie adresu należy do wołającego. */
export async function obroconeZdjecie(url: string, obrot: Obrot): Promise<string> {
  const obraz = new Image();
  obraz.src = url;
  await obraz.decode();
  const szer = obraz.naturalWidth;
  const wys = obraz.naturalHeight;
  const wpoprzek = obrot % 180 !== 0;
  const plotno = document.createElement("canvas");
  plotno.width = wpoprzek ? wys : szer;
  plotno.height = wpoprzek ? szer : wys;
  const ctx = plotno.getContext("2d");
  if (!ctx) throw new Error("Przeglądarka nie rysuje obrazów. Otwórz panel w Chrome albo w Edge.");
  ctx.translate(plotno.width / 2, plotno.height / 2);
  ctx.rotate((obrot * Math.PI) / 180);
  ctx.drawImage(obraz, -szer / 2, -wys / 2);
  const plik = await new Promise<Blob | null>((ok) => plotno.toBlob(ok, "image/png"));
  if (!plik) throw new Error("Nie udało się obrócić zdjęcia.");
  return URL.createObjectURL(plik);
}
