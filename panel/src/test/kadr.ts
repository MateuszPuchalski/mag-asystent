/**
 * Atrapa `IntersectionObserver` dla jsdomu (0.260.0).
 *
 * jsdom nie liczy układu, więc nie ma i nie może mieć obserwatora przecięć —
 * a oś rozmowy trzyma na nim jedną decyzję: czy pytanie klienta wypadło
 * z kadru, czyli czy pokazać pasek nad edytorem. Bez atrapy `new
 * IntersectionObserver` wywala się na `undefined`, a z atrapą milczącą
 * pasek nigdy nie powstaje i nie ma czego sprawdzić.
 *
 * Atrapa NIE UDAJE UKŁADU. Ona daje testowi prawo POWIEDZIEĆ, co obserwator
 * zobaczył — a prawdziwe przecięcie mierzy przeglądarka, dokładnie tak samo
 * jak prawdziwe przewijanie o kilka linijek wyżej w `setup.ts`.
 */
type Zgloszenie = {
  cel: Element;
  oddaj: IntersectionObserverCallback;
  obserwator: IntersectionObserver;
};

const obserwowane: Zgloszenie[] = [];

class AtrapaObserwatora {
  readonly root: Element | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(private readonly oddaj: IntersectionObserverCallback) {}

  observe(cel: Element): void {
    obserwowane.push({
      cel, oddaj: this.oddaj,
      obserwator: this as unknown as IntersectionObserver,
    });
  }

  unobserve(cel: Element): void {
    const i = obserwowane.findIndex((z) => z.cel === cel);
    if (i >= 0) obserwowane.splice(i, 1);
  }

  disconnect(): void {
    for (let i = obserwowane.length - 1; i >= 0; i--) {
      if (obserwowane[i].obserwator === (this as unknown as IntersectionObserver)) {
        obserwowane.splice(i, 1);
      }
    }
  }

  takeRecords(): IntersectionObserverEntry[] { return []; }
}

/** Podstawia atrapę pod globalny `IntersectionObserver`. Woła to `setup.ts`. */
export function zainstalujObserwator(): void {
  globalThis.IntersectionObserver =
    AtrapaObserwatora as unknown as typeof IntersectionObserver;
}

/**
 * Mówi wszystkim obserwatorom, że cel jest (albo nie jest) w kadrze.
 *
 * Wynik wpada do stanu Reacta, więc wywołanie idzie w `act(...)` po stronie
 * testu — inaczej React słusznie krzyczy o aktualizacji poza swoją pętlą.
 */
export function ustawKadr(wKadrze: boolean): void {
  /* Kopia listy: `oddaj` może rozłączyć obserwatora i skrócić tablicę
     w trakcie pętli. */
  for (const z of [...obserwowane]) {
    z.oddaj(
      [{ isIntersecting: wKadrze, target: z.cel } as IntersectionObserverEntry],
      z.obserwator);
  }
}

/** Czyści rejestr między testami — woła to `afterEach` z `setup.ts`. */
export function zapomnijObserwatorow(): void {
  obserwowane.length = 0;
}
