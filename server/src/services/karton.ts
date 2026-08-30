import { db, nowIso, transaction } from "../db/db.js";
import { subiekt } from "../context.js";
import { logEvent } from "./events.js";
import {
  BladKosza,
  RODZAJ_KARTON,
  szczegolKosza,
  towarZKodu,
  type SzczegolKosza,
} from "./kosze.js";

/* ── KARTON: rozkładanie od zera (0.122.0) ───────────────────────────────────
   Pakujący odkładają do jednego pudła towary źle zebrane pod zamówienia.
   Ktoś musi je potem rozłożyć na półki, a do tego wydania nie było na to
   żadnej drogi: rozkładanie znało wyłącznie dokument (dostawa) albo kosz
   zwrotowy (MM z Subiekta, zwrot Allegro).

   Cykl życia kartonu:

     hala: NOWY KARTON → pusty kosz w statusie `otwarty`
     hala: skan albo symbol dokłada pozycje; ten sam towar SUMUJE ilość
     hala: ZATWIERDŹ → `zamkniety`, czyli lista pracy jest kompletna
     hala: dalej robi to samo, co przy koszu zwrotowym — skan towaru, skan
           półki, ZAKOŃCZ

   Ten plik obsługuje WYŁĄCZNIE pierwsze trzy kroki. Czwarty należy do
   `services/kosze.ts` i jest wspólny, bo rozkładanie kartonu i rozkładanie
   kosza to ta sama praca — dlatego karton siedzi w tabeli `kosz`.

   Czego tu nie ma i nie będzie: dokumentu. Towar nie opuścił magazynu, więc
   nie ma czego przesuwać — `zakonczKosz` pilnuje, żeby karton nie zakolejkował
   MM (patrz komentarz przy tamtym warunku).                                  */

/** Prefiks kodu kartonu — patrz `nadajKod`. */
const PREFIKS = "K-";

/**
 * Górna granica ilości w jednej pozycji. Ta sama liczba co przy wpisie ilości
 * na kolektorze (`core/text/Qty.kt`): cicho przycięta ilość wygląda jak
 * przyjęta, a pytanie brzmi „ile sztuk naprawdę leży w pudle".
 */
export const MAKS_ILOSC = 99_999;

/**
 * Kod nadaje APLIKACJA, bo nikt inny nie może — karton nie ma dokumentu
 * w Subiekcie, z którego numeru dałoby się go przepisać.
 *
 * Prefiks `K-` nie jest ozdobą. Numery z kartek przy koszach zwrotowych to
 * gołe liczby („1209"), więc bez prefiksu skan kartki mógłby kiedyś trafić
 * w karton — a pomyłka, która wygląda na sukces, jest gorsza od braku wyniku.
 *
 * Pętla po zajętości kodu jest tania i broni przed jedynym realnym zderzeniem:
 * koszem, któremu ktoś kiedyś wpisał ręcznie kod w tym formacie. Licznik sam
 * z siebie nie cofa się nigdy.
 */
function nadajKod(): string {
  const d = db();
  for (let i = 0; i < 50; i++) {
    d.prepare("UPDATE counters SET value = value + 1 WHERE name = 'karton'").run();
    const w = d.prepare("SELECT value FROM counters WHERE name = 'karton'").get() as
      | { value: number }
      | undefined;
    if (!w) throw new BladKosza(500, "Brak licznika kartonów — baza nie wykonała schematu");
    const kod = PREFIKS + w.value;
    const zajety = d
      .prepare("SELECT id FROM kosz WHERE kod = ? AND status <> 'rozlozony'")
      .get(kod) as { id: number } | undefined;
    if (!zajety) return kod;
  }
  throw new BladKosza(500, "Nie udało się nadać wolnego kodu kartonu");
}

interface WierszKartonu {
  id: number;
  kod: string;
  status: string;
  rodzaj: string;
}

/** Karton o tym id — z odmową, gdy to kosz zwrotowy pod przebraniem. */
function karton(koszId: number): WierszKartonu {
  const k = db().prepare("SELECT id, kod, status, rodzaj FROM kosz WHERE id = ?").get(koszId) as
    | WierszKartonu
    | undefined;
  if (!k) throw new BladKosza(404, `Karton ${koszId} nie istnieje`);
  if (k.rodzaj !== RODZAJ_KARTON) {
    throw new BladKosza(400, `Kosz ${k.kod} to zwroty — zawartość składa biuro, nie hala`);
  }
  return k;
}

/** Karton, do którego wolno jeszcze dokładać. */
function otwartyKarton(koszId: number): WierszKartonu {
  const k = karton(koszId);
  if (k.status === "anulowany") throw new BladKosza(400, `Karton ${k.kod} jest anulowany`);
  if (k.status !== "otwarty") {
    throw new BladKosza(400, `Karton ${k.kod} jest zatwierdzony — teraz się go rozkłada, nie zbiera`);
  }
  return k;
}

/** Ilość z żądania — odrzucamy zamiast przycinać, tak samo jak kolektor. */
function sprawdzIlosc(ilosc: number): number {
  if (!Number.isFinite(ilosc) || ilosc <= 0) throw new BladKosza(400, "Ilość musi być większa od zera");
  if (ilosc > MAKS_ILOSC) throw new BladKosza(400, `Ilość ponad ${MAKS_ILOSC} to pomyłka palca, nie zawartość pudła`);
  return ilosc;
}

export function zalozKarton(autor: string): SzczegolKosza {
  const d = db();
  let id = 0;
  transaction(d, () => {
    const kod = nadajKod();
    const res = d
      .prepare(
        `INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez)
         VALUES (?, 'otwarty', ?, ?, ?)`
      )
      .run(kod, RODZAJ_KARTON, nowIso(), autor);
    id = Number(res.lastInsertRowid);
    logEvent("karton_zalozony", autor, null, { koszId: id, kod });
  })();
  return szczegolKosza(id);
}

/**
 * Skąd wiadomo, JAKI towar dokładamy. Dwie drogi, bo są to dwie różne czynności.
 *
 * `code` to skan albo wpis — napis, który dopiero trzeba rozwiązać, i serwer
 * jest właścicielem tej reguły (`towarZKodu`).
 *
 * `twId` (0.123.0) to WSKAZANIE wiersza z listy wyszukiwarki. Człowiek już
 * obejrzał symbol, nazwę i półkę, i wybrał wzrokiem. Rozwiązywanie tego drugi
 * raz z napisu cofałoby decyzję, którą właśnie podjął — a przy niejednoznacznym
 * symbolu mogłoby ją nawet zmienić.
 */
export type WyborTowaru = { twId: number } | { code: string };

export interface DodanieDoKartonu {
  pozycjaId: number;
  symbol: string;
  nazwa: string;
  /** Ilość po dodaniu — nie ta z żądania, bo skan tego samego towaru SUMUJE. */
  ilosc: number;
}

/**
 * Dodanie towaru do kartonu skanem albo symbolem.
 *
 * Skan bez podanej ilości znaczy JEDNĄ SZTUKĘ i drugi skan tego samego towaru
 * podnosi tamtą pozycję zamiast tworzyć nową. Tak wygląda praca przy pudle:
 * człowiek wyjmuje sztukę po sztuce, a nie liczy najpierw wszystkiego.
 * Dwie pozycje na ten sam towar kazałyby potem odkładać go dwa razy.
 */
export function dodajDoKartonu(
  koszId: number,
  wybor: WyborTowaru,
  ilosc: number | null,
  autor: string
): DodanieDoKartonu | { nieznany: true } {
  const k = otwartyKarton(koszId);
  const ile = ilosc == null ? 1 : sprawdzIlosc(ilosc);
  const tw = "twId" in wybor ? subiekt.getProductById(wybor.twId) : towarZKodu(wybor.code);
  if (!tw) return { nieznany: true };

  const d = db();
  let wynik: DodanieDoKartonu | null = null;
  transaction(d, () => {
    const istnieje = d
      .prepare("SELECT id, ilosc FROM kosz_pozycja WHERE kosz_id = ? AND tw_id = ? ORDER BY id LIMIT 1")
      .get(k.id, tw.tw_id) as { id: number; ilosc: number } | undefined;
    if (istnieje) {
      const suma = sprawdzIlosc(istnieje.ilosc + ile);
      d.prepare("UPDATE kosz_pozycja SET ilosc = ? WHERE id = ?").run(suma, istnieje.id);
      wynik = { pozycjaId: istnieje.id, symbol: tw.symbol, nazwa: tw.nazwa, ilosc: suma };
    } else {
      const res = d
        .prepare(
          `INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(k.id, tw.tw_id, tw.symbol, tw.nazwa, ile);
      wynik = { pozycjaId: Number(res.lastInsertRowid), symbol: tw.symbol, nazwa: tw.nazwa, ilosc: ile };
    }
    logEvent("karton_pozycja", autor, tw.tw_id, {
      koszId: k.id,
      kod: k.kod,
      symbol: tw.symbol,
      dodano: ile,
      ilosc: wynik!.ilosc,
    });
  })();
  return wynik!;
}

/** Pozycja otwartego kartonu — wspólna bramka dla poprawki i usunięcia. */
function pozycjaOtwartego(pozycjaId: number): { id: number; kosz_id: number; tw_id: number; symbol: string } {
  const p = db()
    .prepare("SELECT id, kosz_id, tw_id, symbol FROM kosz_pozycja WHERE id = ?")
    .get(pozycjaId) as { id: number; kosz_id: number; tw_id: number; symbol: string } | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  otwartyKarton(p.kosz_id);
  return p;
}

/**
 * Ilość wpisana z klawiatury NADPISUJE, a nie dodaje.
 *
 * Sumowanie należy do skanu, bo skan jest jednym ruchem ręki. Wpis to ktoś,
 * kto policzył zawartość i mówi, ile jej jest — doliczanie do tego, co już
 * stoi w pozycji, byłoby odpowiedzią na inne pytanie.
 */
export function ustawIloscKartonu(pozycjaId: number, ilosc: number, autor: string): void {
  const p = pozycjaOtwartego(pozycjaId);
  const ile = sprawdzIlosc(ilosc);
  db().prepare("UPDATE kosz_pozycja SET ilosc = ? WHERE id = ?").run(ile, p.id);
  logEvent("karton_ilosc", autor, p.tw_id, { koszId: p.kosz_id, pozycjaId: p.id, ilosc: ile });
}

/**
 * Usunięcie pozycji dołożonej przez pomyłkę — WYŁĄCZNIE przed zatwierdzeniem.
 *
 * Po ZATWIERDŹ lista jest zapisem tego, co fizycznie leży w pudle, i znika
 * z niej wyłącznie przez odłożenie albo pominięcie z powodem. Kasowanie
 * wiersza zabierałoby ślad po pracy, której ktoś już nie wykona.
 */
export function usunPozycjeKartonu(pozycjaId: number, autor: string): void {
  const p = pozycjaOtwartego(pozycjaId);
  db().prepare("DELETE FROM kosz_pozycja WHERE id = ?").run(p.id);
  logEvent("karton_pozycja_usunieta", autor, p.tw_id, {
    koszId: p.kosz_id,
    pozycjaId: p.id,
    symbol: p.symbol,
  });
}

/**
 * ZATWIERDŹ — koniec zbierania, początek rozkładania.
 *
 * Pusty karton odmawia: `zakonczKosz` zamknąłby go w tej samej sekundzie,
 * a w dzienniku zostałoby pudło, które powstało i zniknęło bez treści.
 */
/**
 * ANULUJ — pudło, którego nikt nie rozłoży.
 *
 * Dostępne NA KAŻDYM ETAPIE, także po zatwierdzeniu (decyzja właściciela).
 * Karton bywa otwarty przez pomyłkę, bywa też porzucony w połowie, bo ktoś
 * zabrał zawartość ręką — a do 0.123.0 jedynym wyjściem było rozłożenie
 * wszystkiego albo pominięcie każdej pozycji z powodem.
 *
 * DWA ZAKOŃCZENIA, bo to dwie różne rzeczy:
 *
 *   pusty        → wiersz ZNIKA z bazy. Karton bez ani jednej pozycji to
 *                  pomyłka palca, nie historia; zostawiony w tabeli byłby
 *                  śmieciem na liście biura i niczym więcej.
 *   z zawartością → status `anulowany` ze znacznikiem kto i kiedy. Ktoś
 *                  zeskanował te rzeczy i odszedł od pudła — to jest fakt,
 *                  o który biuro zapyta, więc pozycje ZOSTAJĄ.
 *
 * CZEGO ANULOWANIE NIE ROBI: nie cofa odłożeń. Pozycja postawiona na półce
 * naprawdę tam stoi, a jej zapis adresu jest prawdą o magazynie — anulowanie
 * dotyczy pracy, która ZOSTAŁA do zrobienia, nie tej, która się wydarzyła.
 * Tym różni się od `cofnijOdlozenie`, które kasuje zadanie, dopóki czeka.
 */
export function anulujKarton(koszId: number, autor: string): { usuniety: boolean } {
  const k = karton(koszId);
  if (k.status === "rozlozony") {
    throw new BladKosza(400, `Karton ${k.kod} jest już rozłożony — nie ma czego anulować`);
  }
  if (k.status === "anulowany") return { usuniety: false }; // drugie kliknięcie

  const d = db();
  let usuniety = false;
  transaction(d, () => {
    const pozycje = d
      .prepare("SELECT status FROM kosz_pozycja WHERE kosz_id = ?")
      .all(k.id) as Array<{ status: string }>;
    /* Liczby jadą do dziennika, bo anulowanie po ZATWIERDŹ jest cichą drogą
       porzucenia pracy. Pastylka w biurze mówi „anulowany"; dopiero te dwie
       liczby mówią, ILE roboty przy tym zostało nietkniętej. */
    const odlozonych = pozycje.filter((p) => p.status === "done").length;
    const zostalo = pozycje.length - odlozonych;
    if (pozycje.length === 0) {
      d.prepare("DELETE FROM kosz WHERE id = ?").run(k.id);
      usuniety = true;
    } else {
      d.prepare("UPDATE kosz SET status='anulowany', anulowano_at=?, anulowano_przez=? WHERE id=?")
        .run(nowIso(), autor, k.id);
    }
    logEvent("karton_anulowany", autor, null, {
      koszId: k.id,
      kod: k.kod,
      pozycji: pozycje.length,
      odlozonych,
      zostalo,
      usuniety,
    });
  })();
  return { usuniety };
}

export function zatwierdzKarton(koszId: number, autor: string): SzczegolKosza {
  const k = karton(koszId);
  /* Anulowany NIE jest „już zatwierdzony" i nie wolno go zbyć jak drugie
     kliknięcie: odpowiedź 200 na pudle, które ktoś właśnie odwołał, kazałaby
     rozkładać zawartość odpisaną na straty. */
  if (k.status === "anulowany") throw new BladKosza(400, `Karton ${k.kod} jest anulowany`);
  if (k.status !== "otwarty") return szczegolKosza(k.id); // drugie kliknięcie
  const { ile } = db()
    .prepare("SELECT COUNT(*) AS ile FROM kosz_pozycja WHERE kosz_id = ?")
    .get(k.id) as { ile: number };
  if (ile === 0) throw new BladKosza(400, "Pusty karton nie ma czego rozkładać");
  db()
    .prepare("UPDATE kosz SET status='zamkniety', zamknieto_at=?, zamknieto_przez=? WHERE id=?")
    .run(nowIso(), autor, k.id);
  logEvent("karton_zatwierdzony", autor, null, { koszId: k.id, kod: k.kod, pozycji: ile });
  return szczegolKosza(k.id);
}
