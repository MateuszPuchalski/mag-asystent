import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useDokument, wyjatkiDostawy, type Wyjatek } from "../api/dostawy";
import { useZdjecieDowodu } from "../towar/useZdjecie";
import { firma } from "./firma";
import { STYL_ANEKSU, protokol } from "./szablony";

/* ── Druk protokołu dla dostawcy (0.435.0) ─────────────────────────────────
   W `biuro.html` druk otwierał się przez `window.open` i `document.write`:
   karta bez adresu, której nie dało się odświeżyć ani wkleić koledze, a po
   zamknięciu nie było do niej powrotu. Tu ma adres `/obsluga/druk/protokol/
   :dokId` i rysuje się POZA ramą panelu — bez nagłówka i zakładek, bo to jest
   kartka do wydruku, a nie ekran pracy.

   Adres niesie `dokId`, nie `deliveryId`: numer faktury, dostawcę i datę
   daje podgląd dokumentu, a wyjątki bierze się po `deliveryId` z tego samego
   podglądu. Jeden adres, dwa odczyty, zero zapisu. */

function Fotka({ p }: { p: Wyjatek }) {
  const { url } = useZdjecieDowodu(p.id);
  /* Brak obrazu nie psuje druku: aneks jest dowodem dodatkowym, a protokół
     stoi bez niego. Zdjęcie w drodze pokazuje się, zanim ktoś kliknie DRUKUJ. */
  if (!url) return null;
  return <figure>
    <img src={url} alt="" />
    <figcaption>{p.sym ?? p.symObcy ?? ""} · {p.typLabel || p.typ}{p.opis ? ` · ${p.opis}` : ""}</figcaption>
  </figure>;
}

export function Protokol() {
  const { dokId } = useParams();
  const dok = useDokument(dokId ? Number(dokId) : null);
  const deliveryId = dok.data?.deliveryId ?? null;
  const wyjatki = useQuery({
    queryKey: ["druk", "wyjatki", deliveryId],
    queryFn: () => wyjatkiDostawy(deliveryId!),
    enabled: deliveryId != null,
  });

  const druk = dok.data && wyjatki.data
    ? protokol({ nrPelny: dok.data.nrPelny, dostawca: dok.data.dostawca, dataWyst: dok.data.dataWyst },
        wyjatki.data.problems, firma())
    : null;
  useEffect(() => { if (druk) document.title = druk.tytul; }, [druk?.tytul]);

  if (dok.error || wyjatki.error) {
    return <p style={{ padding: 24 }}>{((dok.error ?? wyjatki.error) as Error).message}</p>;
  }
  if (dok.data && deliveryId == null) {
    return <p style={{ padding: 24 }}>Tego dokumentu nikt nie rozkładał — nie ma wyjątków do protokołu.</p>;
  }
  if (!druk || !wyjatki.data) return <p style={{ padding: 24 }}>Wczytuję protokół…</p>;
  const zeZdjeciem = wyjatki.data.problems.filter((p) => p.hasPhoto);

  return <div className="druk">
    <style>{druk.styl + STYL_ANEKSU}</style>
    <button type="button" className="drukuj" onClick={() => window.print()}>DRUKUJ</button>
    {/* Treść szablonu to HTML dostawcy z wartościami przepuszczonymi przez
        `esc` w `szablony.ts` — patrz tamten nagłówek, dlaczego nie JSX. */}
    <div dangerouslySetInnerHTML={{ __html: druk.tresc }} />
    {zeZdjeciem.length > 0 && <section className="aneks">
      <h1>Zdjęcia dowodowe</h1>
      {zeZdjeciem.map((p) => <Fotka key={p.id} p={p} />)}
    </section>}
  </div>;
}
