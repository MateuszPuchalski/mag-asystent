import type { PozycjaZwrotu, Zwrot } from "../api/typy";

/* ── SZYBKA ŚCIEŻKA ZWROTU (0.481.0) ──────────────────────────────────────
   Zgłoszenie właściciela: „większość zwrotów jest w porządku i może od razu
   jechać na półkę". Typowy zwrot to i tak ten sam ciąg: przyjmij, każda
   pozycja na stan, pełna kwota, pieniądze w Allegro. Tu stoi REGUŁA, kiedy
   ten ciąg wolno puścić jednym ruchem — ekran tylko ją pyta.

   Ścieżka NIE ZGADUJE. Każdy przypadek, w którym człowiek musiałby coś
   rozstrzygnąć, zatrzymuje ją PRZED pierwszym zapisem i mówi dlaczego:
   zwrot rozjechany w połowie ciągu jest gorszy od zwrotu nietkniętego.     */

/** Pewne źródła kartoteki — te same, które przycisk hurtowy zatwierdza w `Pozycje.tsx`. */
export const pewnaPropozycja = (p: PozycjaZwrotu): boolean =>
  p.propozycja?.twId != null
  && (p.propozycja.pewnosc === "sku" || p.propozycja.pewnosc === "pamiec");

/**
 * Czy oddajemy koszt dostawy — wraca CAŁE zamówienie (0.476.0).
 *
 * Podpowiedź dla HACZYKA na ekranie ręcznym (`Pozycje.tsx`), nie decyzja.
 * Od 0.484.5 szybka ścieżka z niej nie korzysta: decyzją właściciela „Wszystko
 * OK" oddaje sumę pozycji bez dostawy. Reguła stoi tu dalej, bo ekran ręczny
 * ją czyta, a jej test mieszka obok.
 */
export function calaDostawa(zwrot: Zwrot): boolean {
  const poz = zwrot.zamowienie?.pozycje ?? [];
  return poz.length > 0 && poz.every((p) => p.zwracana && p.wracaIlosc >= p.ilosc);
}

/** Pudło przy biurku — tyle, ile reguła musi wiedzieć. */
export type PudloSzybkie = { rodzaj: string; pozycje: Array<{ zwrotId?: number | null }> };

export type SzybkaSciezka =
  | { pokaz: false }
  | { pokaz: true; przeszkoda: string | null };

/**
 * Czy szybka ścieżka stoi na ekranie i czy wolno ją puścić.
 *
 * `pokaz: false` — zwrot jest poza jej zasięgiem (zamknięty, odrzucony, kwota
 * już zapisana). `przeszkoda` — przycisk stoi, ale mówi, co zrobić najpierw.
 */
export function szybkaSciezka(zwrot: Zwrot, pudla: PudloSzybkie[]): SzybkaSciezka {
  const wZasiegu = (zwrot.kubelek === "decyzja" || zwrot.kubelek === "ocena"
    || zwrot.kubelek === "zwrot") && zwrot.kwotaGrosze === null
    && zwrot.werdykt !== "odrzucony";
  /* Paczka nieodebrana nie ma zwrotu w Allegro — nie ma czego oddawać ani
     gdzie. Pieniądze przy niej to inna rozmowa z klientem. */
  /* KLIENT NIE ODESŁAŁ (@wydanie) — miejsce przycisku zajmuje gotowa odmowa
     (`NieOdeslany`). Dwa przyciski na jedną decyzję, z czego jeden oddaje
     pieniądze za towar, którego nie ma, to pomyłka czekająca na klawisz. */
  if (!wZasiegu || zwrot.zrodlo === "nieodebrana" || zwrot.sygnaly.includes("nie_odeslany")) {
    return { pokaz: false };
  }

  const stop = (przeszkoda: string): SzybkaSciezka => ({ pokaz: true, przeszkoda });
  /* PACZKA MUSI WRÓCIĆ (@wydanie). Zgłoszenie właściciela przy 5ZRQ/2026:
     przycisk proponował „na półkę i oddaj" za filtr, który nigdy nie
     przyjechał. `brak_dowodu` liczy serwer z trackingu. Gdy karton leży
     przy biurku, a tracking się spóźnia, droga ręczna zostaje otwarta. */
  if (zwrot.sygnaly.includes("brak_dowodu")) {
    return stop("Paczka jeszcze nie wróciła — jeśli karton jest przy biurku, przyjmij ręcznie (P).");
  }
  if (!zwrot.linkZwrotu) return stop("Brak odnośnika do zwrotu w Allegro — oddaj pieniądze ręcznie.");
  if (!zwrot.pozycje.length) return stop("Zwrot bez pozycji — dopisz, co przyszło w kartonie.");

  /* „Wszystko w porządku" znaczy: nic nie odbiega od zamówienia. Potrącenie,
     brak sztuk albo inna ocena to decyzja człowieka, której ciąg nie powtórzy. */
  if (zwrot.pozycje.some((p) => p.ocena !== null && p.ocena !== "stan")) {
    return stop("Część pozycji ma inną ocenę niż „na stan” — dokończ ręcznie.");
  }
  if (zwrot.pozycje.some((p) => p.potracenieGrosze !== null
    || (p.iloscZwrocona !== null && p.iloscZwrocona < p.ilosc))) {
    return stop("Jest potrącenie albo brak sztuk — dokończ ręcznie.");
  }
  /* OCENIONA, A NIE W PUDLE (0.484.2). Ocena „na stan" zapisuje się
     także wtedy, gdy serwer pozycji do pudła nie dołożył: komplet bez składu,
     składnik poza magazynem, brak magazynu docelowego. Ciąg ocenia wyłącznie
     pozycje bez oceny, więc taką by pominął — i oddał pieniądze za towar,
     którego nie ma na MM. Powód stoi przy pozycji (`sklady`), stąd odesłanie. */
  const pozaPudlem = zwrot.pozycje.find((p) => p.ocena === "stan" && !p.wKoszyku);
  if (pozaPudlem) {
    return stop(`„${pozaPudlem.nazwa}” jest „na stan”, ale nie leży w pudle — powód stoi przy pozycji.`);
  }
  /* Bez kartoteki towar nie wejdzie na MM, czyli nie trafi na półkę
     w Subiekcie. Zgadywana propozycja zostaje pod okiem (`sygnatury.ts`). */
  const bezKartoteki = zwrot.pozycje.find((p) => p.twId === null && !pewnaPropozycja(p));
  if (bezKartoteki) return stop(`„${bezKartoteki.nazwa}” nie ma pewnej kartoteki — wskaż ją.`);

  /* PUDŁA NIE ZGADUJEMY — decyzja właściciela z 0.379.0. Przy jednym albo
     zerze serwer rozstrzyga sam; przy kilku bierzemy tylko to, w którym leży
     już towar tego zwrotu. */
  if (zwrot.pozycje.some((p) => p.ocena === null)) {
    const naZwroty = pudla.filter((k) => k.rodzaj === "zwroty");
    const zTymZwrotem = naZwroty.filter((k) => k.pozycje.some((p) => p.zwrotId === zwrot.id));
    if (naZwroty.length > 1 && zTymZwrotem.length !== 1) {
      /* W DO DECYZJI przycisków pudeł jeszcze nie ma — stoją przy ocenie,
         więc zdanie zaczyna od przyjęcia (0.484.7). */
      return stop(zwrot.kubelek === "decyzja"
        ? "Kilka otwartych pudeł — przyjmij zwrot (P) i oceń pierwszą pozycję w wybranym pudle, resztę zrobi przycisk."
        : "Kilka otwartych pudeł — oceń pierwszą pozycję w wybranym pudle, resztę zrobi przycisk.");
    }
  }
  return { pokaz: true, przeszkoda: null };
}
