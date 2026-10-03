import { useEffect, useRef, useState } from "react";

/* ── CO W SKRZYNCE JEST NOWE, żeby ruch zagrał RAZ ───────────────────────────
   Skrzynka odświeża się w tle: wiersz albo wiadomość po prostu się pojawia,
   a to jest dokładnie ta zmiana, która umyka. Ruch ma ją pokazać, ale nigdy nie
   może grać przy otwarciu ekranu ani rozmowy, bo wtedy migałaby cała lista.

   REGUŁY, które ten haczyk pilnuje za wywołujących:
   1. PIERWSZY odczyt po `gotowe` tylko zapamiętuje, co jest. Nic nie błyska.
   2. Kolejne odczyty błyskają tym, czego wcześniej nie było. „Znane" to zawsze
      OSTATNI zestaw, nie suma wszystkich: element, który zniknął i wrócił,
      jest znowu nowy (wiersz wraca do „Do odpowiedzi" po odpowiedzi klienta).
   3. Zmiana `kontekst` (inna rozmowa) zaczyna od zera, jak pierwszy odczyt.
   4. Oznaczenie gaśnie po `trwanieMs`, więc ponowne zamontowanie wiersza
      (przełączenie kubełka tam i z powrotem) nie odgrywa ruchu drugi raz.

   Sam haczyk niczego nie animuje i nie zna CSS. Zwraca zbiór kluczy; klasę
   `motion-safe:animate-*` dokłada wywołujący, żeby `prefers-reduced-motion`
   był widoczny w jednym miejscu, przy elemencie. */

export function useNoweKlucze(
  klucze: string[], gotowe: boolean, kontekst: string | number = "", trwanieMs = 2000,
): ReadonlySet<string> {
  const znane = useRef<Set<string> | null>(null);
  const ostatniKontekst = useRef(kontekst);
  const [nowe, setNowe] = useState<ReadonlySet<string>>(new Set());
  const podpis = klucze.join("\u0000");

  useEffect(() => {
    if (ostatniKontekst.current !== kontekst) {
      ostatniKontekst.current = kontekst;
      znane.current = null;
      setNowe(new Set());
    }
    if (!gotowe) return;
    const teraz = new Set(klucze);
    const poprzednie = znane.current;
    znane.current = teraz;
    if (poprzednie === null) return;
    const swieze = klucze.filter((k) => !poprzednie.has(k));
    if (swieze.length === 0) return;
    setNowe((o) => new Set([...o, ...swieze]));
    const t = window.setTimeout(() => {
      setNowe((o) => {
        const reszta = new Set(o);
        for (const k of swieze) reszta.delete(k);
        return reszta;
      });
    }, trwanieMs);
    return () => window.clearTimeout(t);
    // `podpis` zastępuje tablicę, której tożsamość zmienia się przy każdym renderze.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podpis, gotowe, kontekst, trwanieMs]);

  return nowe;
}
