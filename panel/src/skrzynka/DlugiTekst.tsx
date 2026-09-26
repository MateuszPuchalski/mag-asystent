import React from "react";

/* ── JEDNO ZWINIĘCIE DLA OSI ROZMOWY (@wydanie) ──────────────────────────────
   Oś miała trzy ręcznie pisane przełączniki: stopkę, autoodpowiedź i naszą
   długą wypowiedź. Każdy z innym wyglądem i innym progiem, a karta towaru
   powtarzała próg 320 znaków czwarty raz. Zgłoszenie agentów brzmiało
   „przytłacza" — trzy wyglądy jednej czynności to trzy rzeczy do nauczenia.
   Próg i przełącznik mają więc jeden zapis; wołający podaje tylko treść. */

/** Ile znaków znaczy „długie". Czyta go też opis kartoteki w `TowarRozmowy`. */
export const PROG_ZNAKOW = 320;
/** Ile wierszy mieści się bez zwijania — krótka lista kroków nie jest ścianą. */
export const PROG_LINII = 5;

export function dlugi(tekst: string): boolean {
  return tekst.length > PROG_ZNAKOW || tekst.split("\n").length > PROG_LINII;
}

/** Stan „zwinięte / całość" z gotowymi atrybutami przycisku — dla wpisu,
    który rysuje przełącznik we własnym nagłówku (autoodpowiedź). */
export function useRozwiniecie() {
  const [otwarte, setOtwarte] = React.useState(false);
  return {
    otwarte,
    przelacznik: { "aria-expanded": otwarte, onClick: () => setOtwarte((o) => !o) },
  };
}

/* Jeden wygląd przełącznika: odnośnik, nie przycisk z ramką. Rozwinięcie
   to czytanie, nie działanie — nie ma prawa konkurować z „Wyślij". */
export const KLASA_PRZELACZNIKA = "text-xs font-semibold text-sky-800 underline underline-offset-2";

/**
 * Nasza wypowiedź: długa zwija się do czterech linii, stopka firmowa
 * chowa się cała — i obie wracają JEDNYM przełącznikiem (@wydanie).
 *
 * Do tego wydania wiadomość długa i podpisana miała pod sobą dwa przyciski,
 * „Pokaż całą wiadomość" i „stopka firmowa". Oba odsłaniały tę samą rzecz:
 * resztę tego, co klient dostał. Zwinięte, nie skasowane — przy sporze
 * całość musi dać się przeczytać w panelu.
 */
export function DlugiTekst({ tresc, stopka, className = "" }: {
  tresc: string;
  /** Część chowana w całości (blok firmowy) — odsłania ją ten sam przełącznik. */
  stopka?: string | null;
  className?: string;
}) {
  const { otwarte, przelacznik } = useRozwiniecie();
  const zwijaj = dlugi(tresc);
  /* Krótka wiadomość ze stopką mówi, co schowane — „Pokaż całą wiadomość"
     pod dwoma zdaniami brzmiałoby, jakby coś z nich zginęło. */
  const [pokaz, zwin] = zwijaj ? ["Pokaż całą wiadomość", "Zwiń"] : ["stopka firmowa", "ukryj stopkę firmową"];
  return <>
    <p className={`mt-1 whitespace-pre-wrap ${className} ${zwijaj && !otwarte ? "line-clamp-4" : ""}`}>
      {tresc}</p>
    {otwarte && stopka && <p className="mt-1 whitespace-pre-wrap border-t pt-1 text-xs text-slate-500">
      {stopka}</p>}
    {(zwijaj || Boolean(stopka)) && <button type="button" {...przelacznik} className={`mt-1 block ${KLASA_PRZELACZNIKA}`}>
      {otwarte ? zwin : pokaz}</button>}
  </>;
}
