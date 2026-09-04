import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { autoryzuj } from "../services/auth.js";
import { transaction } from "../db/db.js";
import { db } from "../db/db.js";
import {
  koszykiCzekajaceNaKorekty, stanOtwartegoKosza, wypuscGotoweKoszyki, zamknijKosz,
} from "../services/kosze-zwrotow.js";
import {
  bilansKartotek, cofnijKorekte, csvZwrotow, licznikiKubelkow, listaZwrotow, ocenPozycje, osZwrotu,
  potwierdzKartoteke, rozstrzygnijZwrot, zapiszKorekte, zapiszKwote, zapiszPotracenie,
  zarejestrujNieodebrana,
  znajdzZwrotPoKodzie,
  ZwrotConflict,
  dopiszPozycje, doDopisania, usunDopisanaPozycje,
} from "../services/zwroty.js";
import { RabatConflict, zlozWniosekORabat } from "../services/rabaty.js";
import { odmowZwrotuPieniedzy as wyslijOdmowe, zglosRabat, zwrocPlatnosc } from "../adapters/allegro.http.js";
import {
  odmowZwrotuPieniedzy, stanZwrotuPieniedzy, zwrocPieniadze, ZwrotPieniedzyConflict,
} from "../services/zwrot-pieniedzy.js";
import { uzupelnijZamowienia } from "../services/allegro-zamowienia-sync.js";
import { zwiazPewne } from "../services/sygnatury.js";
import {
  kandydaciFaktury, wskazFakture, zwiazFakturyPewne, zwiazKorektyPewne,
} from "../services/faktury.js";
import { dociagnijZwrotPoLiscie } from "../services/allegro-zwroty-sync.js";
import { config } from "../config.js";
import { logEvent } from "../services/events.js";
import { stanZwrotowHealth } from "../services/allegro-zwroty-sync-state.js";

/* ── Trasy zwrotów klienckich (0.150.0, decyzje biura od 0.156.0) ────────────
   SZEŚĆ ZAPISÓW: kartoteka pozycji, werdykt, ocena towaru, kwota oraz — od
   0.162.0 — numer korekty i jego cofnięcie. Nic nie wychodzi stąd do Allegro
   ani do Subiekta: korektę wystawia człowiek w Subiekcie, a pieniądze oddaje
   w panelu Allegro. Panel zapisuje FAKT, że to się stało.

   Oddanie pieniędzy przez API czeka na końcówki zapisu Allegro, których sonda
   nie potwierdzi (jest GET-em).

   Bramka roli stoi na KAŻDEJ trasie, także na odczycie — tak samo jak przy
   skrzynce. Zwrot niesie numer zamówienia i nazwisko sprawy klienta; to są
   dane biura, nie hali.                                                     */

const BIURO = ["biuro", "admin"];

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Zwroty prowadzi biuro" });
  }
  return null;
}

export async function zwrotyRoutes(app: FastifyInstance) {
  /* Cała kolejka jednym strzałem razem z licznikami. Panel filtruje kubełkiem
     u siebie, więc przełączenie kubełka nie kosztuje żądania — a to jest
     dokładnie ten koszt, który ten ekran miał zdjąć. */
  app.get("/api/obsluga/zwroty", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const zwroty = listaZwrotow(db());
    return {
      zwroty, liczniki: licznikiKubelkow(zwroty),
      kartoteki: bilansKartotek(zwroty),
      stan: stanZwrotowHealth(db()),
    };
  });

  /* Ręczne dociągnięcie zamówień (§9, wzorzec „synchronizuj teraz" ze
     skrzynki). Bez niego diagnoza na produkcji wymagała czekania dziesięciu
     minut na najrzadszy z trzech tickerów — a to jest dokładnie ten moment,
     w którym ktoś patrzy na ekran i chce wiedzieć, czy problem jest
     w danych, czy w kodzie.

     NIE omija limitu Allegro: pobiera tyle samo co ticker i tak samo
     przerywa na 429. */
  app.post("/api/obsluga/zwroty/zamowienia", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    if (!config.allegro.clientId) {
      return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
    }
    const s = sesjaZadania()!;
    logEvent("zwroty_zamowienia_reczne", s.user.name);
    try {
      const pobrano = await uzupelnijZamowienia();
      /* Powiązanie ZARAZ PO dociągnięciu: to zamówienie niesie sygnaturę,
         więc dopiero teraz jest z czego wiązać. Bez tego operator klikałby
         „dociągnij" i dalej patrzył na „Bez kartoteki" do następnego taktu. */
      /* Korekty i koszyki tą samą drogą (0.201.0): kto klika „dociągnij",
         chce zobaczyć AKTUALNY stan, a nie jego część. */
      const faktury = zwiazFakturyPewne(db());
      const korekty = zwiazKorektyPewne(db());
      wypuscGotoweKoszyki(db());
      return { pobrano, powiazano: zwiazPewne(db()), faktury, korekty };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /* Potwierdzenie kartoteki. `twId: null` ZDEJMUJE powiązanie i to jest droga
     wyjścia z błędnego potwierdzenia, a nie brak funkcji.

     Bez `autoryzuj()`: to nie jest operacja uprzywilejowana, tylko zwykła
     praca biura, a `autoryzuj` pisałoby `privileged` przy każdym kliknięciu
     (ten sam argument co przy odczycie dokumentu w `routes/biuro.ts`). */
  app.post<{ Params: { id: string }; Body: { twId?: number | null; zrodlo?: string } }>(
    "/api/obsluga/zwroty/pozycje/:id/kartoteka", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const s = sesjaZadania()!;
      const zrodlo = req.body?.zrodlo === "sku" ? "sku" : "reczne";
      const twId = req.body?.twId == null ? null : Number(req.body.twId);
      if (twId !== null && !Number.isInteger(twId)) {
        return reply.code(400).send({ error: "twId musi być liczbą całkowitą albo null" });
      }
      try {
        return transaction(db(), () => potwierdzKartoteke(
          db(), Number(req.params.id), twId, zrodlo,
          { id: s.user.userId, name: s.user.name },
        ))();
      } catch (e) {
        /* Nieznana pozycja i nieznany towar to decyzje wołającego, nie awaria
           serwera — ten sam wzorzec co przy domknięciu dostawy. */
        return reply.code(400).send({ error: (e as Error).message });
      }
    });

  /* Konflikt wersji dostaje 409 i SZCZEGÓŁY, tak samo jak przy rozmowie:
     panel ma narysować „inny agent zdążył pierwszy", a nie gołe „błąd". */
  const konflikt = (reply: FastifyReply, e: unknown) => e instanceof ZwrotConflict
    ? reply.code(409).send({ error: e.message, ...e.szczegoly })
    : reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });

  const kto = () => {
    const s = sesjaZadania()!;
    return { id: s.user.userId, name: s.user.name };
  };

  app.post<{ Params: { id: string }; Body: { decyzja?: string; powod?: string; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/werdykt", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const d = req.body?.decyzja;
      if (d !== "przyjety" && d !== "odrzucony") {
        return reply.code(400).send({ error: "Werdykt to `przyjety` albo `odrzucony`." });
      }
      try {
        return rozstrzygnijZwrot(db(), Number(req.params.id), d,
          req.body?.powod ?? null, Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { ocena?: string | null; wersja?: number } }>(
    "/api/obsluga/zwroty/pozycje/:id/ocena", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const o = req.body?.ocena ?? null;
      if (o !== null && !["stan", "przecena", "utylizacja"].includes(o)) {
        return reply.code(400).send({ error: "Ocena to `stan`, `przecena`, `utylizacja` albo brak." });
      }
      try {
        return ocenPozycje(db(), Number(req.params.id), o as never,
          Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* ── Koszyk zwrotów (0.192.0) ──────────────────────────────────────────
     Obieg biura, opisany przez właściciela: „gdy agent zasiada do zwrotów, to
     otwiera pustą MM i dodaje kolejno przedmioty ze zwrotów; gdy koszyk się
     zapełni, zamyka MM i tak w kółko".

     DOKŁADANIA NIE MA W TRASACH i to jest cała sztuczka: dokłada ocena „na
     stan", którą operator i tak naciska. Osobna trasa kazałaby powiedzieć dwa
     razy to samo. Tutaj stoi więc wyłącznie ODCZYT stanu koszyka i jedno
     DOMKNIĘCIE. */
  app.get("/api/obsluga/zwroty/kosz", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    /* `czekajace` jest polem ADDYTYWNYM (0.200.0): koszyki zamknięte, którym
       brakuje korekt, nie należą do żadnego operatora — to praca biura, nie
       jego biurka. Stary panel je zignoruje. */
    return {
      kosz: stanOtwartegoKosza(db(), kto()),
      czekajace: koszykiCzekajaceNaKorekty(db()),
    };
  });

  app.post<{ Body: { koszId?: number } }>(
    "/api/obsluga/zwroty/kosz/zamknij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const id = Number(req.body?.koszId);
      if (!Number.isFinite(id) || id <= 0) {
        return reply.code(400).send({ error: "Podaj koszyk, który mam zamknąć." });
      }
      try {
        return zamknijKosz(db(), id, kto());
      } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
    });

  /* Paczka, której klient nie odebrał (0.172.0). Allegro takiego bytu nie zna,
     więc wiersz zakłada BIURO — i to jest jedyna trasa zwrotów tworząca zwrot
     od zera. Pieniądze i tak trzeba oddać, więc idzie tą samą kolejką, ale
     `zrodlo` mówi wprost, że to nie zgłoszenie klienta. */
  app.post<{ Body: { waybill?: string; orderId?: string | null; notatka?: string | null } }>(
    "/api/obsluga/zwroty/nieodebrana", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return zarejestrujNieodebrana(db(), {
          waybill: String(req.body?.waybill ?? ""),
          orderId: req.body?.orderId ?? null,
          notatka: req.body?.notatka ?? null,
        }, kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* Potrącenie za utratę wartości (0.170.0). To JEDYNA liczba o pieniądzach,
     jaką panel wolno mu przysłać — i dlatego jest walidowana w widełkach
     `0…wartość pozycji`, wymaga powodu i wisi przy POZYCJI, a nie przy sumie.
     Sumę dalej składa serwer z zaznaczenia. */
  /* Dopisanie produktu, którego klient nie zgłosił (0.184.0). Panel przysyła
     identyfikator POZYCJI ZAMÓWIENIA, nigdy nazwy ani ceny: klient może odesłać
     wyłącznie to, co kupił, a cena ma pochodzić z faktu, nie z pola tekstowego
     (§25a.3 — kwotę składa serwer). */
  app.post<{ Params: { id: string }; Body: { zamPozycjaId?: number; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/pozycje", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const zam = Number(req.body?.zamPozycjaId);
      if (!Number.isInteger(zam)) {
        return reply.code(400).send({ error: "Wskaż pozycję zamówienia do dopisania." });
      }
      try {
        return dopiszPozycje(db(), Number(req.params.id), zam, Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* Zdjęcie pozycji dopisanej przez biuro. Pozycji ze zgłoszenia klienta
     serwis nie odda — usunięta u nas wróciłaby przy najbliższym takcie. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/pozycje/:id/zdejmij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return usunDopisanaPozycje(db(), Number(req.params.id), Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { grosze?: number | null; powod?: string; wersja?: number } }>(
    "/api/obsluga/zwroty/pozycje/:id/potracenie", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const g = req.body?.grosze;
      if (g !== null && g !== undefined && typeof g !== "number") {
        return reply.code(400).send({ error: "Potrącenie to liczba groszy albo brak." });
      }
      try {
        return zapiszPotracenie(db(), Number(req.params.id), g ?? null,
          String(req.body?.powod ?? ""), Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* Panel przysyła ZAZNACZENIE, nie kwotę. §25a.3: liczy serwer, panel niczego
     nie zgaduje — inaczej dałoby się zapisać dowolną liczbę z pominięciem
     ekranu, a to są cudze pieniądze. */
  app.post<{ Params: { id: string }; Body: { pozycjeIds?: number[]; dostawa?: boolean; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/kwota", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const ids = req.body?.pozycjeIds;
      if (!Array.isArray(ids) || ids.some((i) => !Number.isInteger(i))) {
        return reply.code(400).send({ error: "`pozycjeIds` to lista identyfikatorów pozycji." });
      }
      try {
        return zapiszKwote(db(), Number(req.params.id),
          { pozycjeIds: ids, dostawa: req.body?.dostawa === true },
          Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* Numer korekty PRZEPISUJE człowiek z Subiekta, więc pomyłka jest tu
     zdarzeniem normalnym — stąd druga trasa, cofająca (§25a.5). */
  app.post<{ Params: { id: string }; Body: { numer?: string; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/korekta", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return zapiszKorekte(db(), Number(req.params.id), req.body?.numer ?? "",
          Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/:id/korekta/cofnij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return cofnijKorekte(db(), Number(req.params.id), Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* RABAT TRANSAKCYJNY (0.164.0) — jedyna trasa tego pliku, która WYCHODZI
     do Allegro. Reszta zapisuje wyłącznie u nas. Stąd osobna ostrożność:
     strażnik przed dubletem stoi w serwisie, PRZED siecią, bo końcówka
     Allegro nie ma idempotencji. */
  app.post<{ Params: { id: string } }>("/api/obsluga/zwroty/pozycje/:id/rabat",
    async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return await zlozWniosekORabat(db(), Number(req.params.id), kto(),
          (lineItemId, ilosc) => zglosRabat(config.allegro.apiUrl, lineItemId, ilosc));
      } catch (e) {
        /* Dublet to 409, nie 400: to nie jest zła prośba, tylko praca już
           wykonana — a ekran ma powiedzieć, KTÓRY wniosek już istnieje. */
        if (e instanceof RabatConflict) return reply.code(409).send({ error: e.message });
        return konflikt(reply, e);
      }
    });

  /* ── Skan etykiety zwrotnej (0.163.0) ─────────────────────────────────────
     TA TRASA JEST POST-em, CHOĆ NICZEGO NIE ZAPISUJE, i to jest świadome.
     Zeskanowany kod w adresie wylądowałby w logu żądań serwera — a numer listu
     przewozowego prowadzi w systemie kuriera do adresu odbiorcy (`ksztalt.ts`,
     0.155.0). Stałby się więc trwały tylnymi drzwiami, mimo że w bazie nie ma
     na niego kolumny. Ten sam argument stoi przy szynie zdarzeń panelu:
     „token lądowałby w logach żądań serwera" (`panel/src/api/zdarzenia.ts`).

     Z tego samego powodu nie ma tu `logEvent`: wpis z kodem w dzienniku byłby
     dokładnie tym zapisem, którego unikamy, a bez kodu nie niósłby nic. */
  /* ── ZWROT PIENIĘDZY I ODMOWA (0.190.0) ────────────────────────────────
     Druga i trzecia trasa tego pliku wychodząca do Allegro — i pierwsza,
     która rusza PIENIĄDZE. Stąd dwie różnice względem reszty:

     `autoryzuj()` obok `odmowa()`: oddanie cudzych pieniędzy to operacja
     uprzywilejowana, a nie zwykła praca biura jak wskazanie kartoteki.

     Kwoty NIE MA W CIELE ŻĄDANIA i to jest ta sama decyzja, co przy
     `zapiszKwote` (0.156.0): gdyby panel podawał liczbę, dałoby się oddać
     dowolną kwotę żądaniem z pominięciem ekranu. Serwer bierze tę, którą sam
     policzył z zaznaczenia. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/:id/pieniadze", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const w = autoryzuj(sesjaZadania()!.user, "zwrot_pieniedzy");
      if (!w.ok) return reply.code(403).send({ error: w.powod });
      try {
        return await zwrocPieniadze(db(), Number(req.params.id), Number(req.body?.wersja),
          kto(), (ciało) => zwrocPlatnosc(config.allegro.apiUrl, ciało));
      } catch (e) {
        if (e instanceof ZwrotPieniedzyConflict) {
          return reply.code(409).send({ error: e.message });
        }
        return reply.code(400).send({ error: (e as Error).message });
      }
    });

  app.post<{ Params: { id: string }; Body: { kod?: string; powod?: string; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/odmowa-platnosci", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const w = autoryzuj(sesjaZadania()!.user, "zwrot_pieniedzy");
      if (!w.ok) return reply.code(403).send({ error: w.powod });
      try {
        return await odmowZwrotuPieniedzy(db(), Number(req.params.id), req.body?.kod ?? "",
          req.body?.powod ?? null, Number(req.body?.wersja), kto(),
          (zwrotId, kod, powod) => wyslijOdmowe(config.allegro.apiUrl, zwrotId, kod, powod));
      } catch (e) {
        if (e instanceof ZwrotPieniedzyConflict) {
          return reply.code(409).send({ error: e.message });
        }
        return reply.code(400).send({ error: (e as Error).message });
      }
    });

  app.post<{ Body: { kod?: string } }>("/api/obsluga/zwroty/skan", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const kod = (req.body?.kod ?? "").trim();
    if (!kod) return reply.code(400).send({ error: "Pusty kod" });
    return znajdzZwrotPoKodzie(kod, db());
  });

  /* Skan, który nie trafił w nic u nas. Paczka bywa w biurze szybciej, niż
     zwrot doleci synchronizacją, więc pytamy Allegro o TEN JEDEN numer listu
     zamiast kazać czekać na ticker.

     Ta trasa ZAPISUJE (dociąga zwrot), więc woła `logEvent` — bez kodu
     w danych zdarzenia, z tego samego powodu co wyżej. */
  app.post<{ Body: { kod?: string } }>("/api/obsluga/zwroty/skan/dociagnij",
    async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const kod = (req.body?.kod ?? "").trim();
      if (!kod) return reply.code(400).send({ error: "Pusty kod" });
      if (!config.allegro.clientId) {
        return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
      }
      const s = sesjaZadania()!;
      try {
        const pobrano = await dociagnijZwrotPoLiscie(kod);
        logEvent("zwrot_skan_dociagniecie", s.user.name, null, { pobrano });
        return { pobrano, ...znajdzZwrotPoKodzie(kod, db()) };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    });

  /**
   * Zestawienie zwrotów do Excela.
   *
   * To JEDYNY GET w tym pliku, który zostawia ślad w dzienniku — i dlatego
   * stoi poza umową „otwarcie kolejki nie zapisuje niczego". Ta umowa mówi
   * o PATRZENIU: otwarcie ekranu niczego nie mutuje (blizna 0.18.0). Pobranie
   * pliku z loginami kupujących nie jest patrzeniem, tylko wyniesieniem
   * danych na dysk — a kto wynosi zestawienia o ludziach, sam trafia do logu.
   * Ta sama zasada stoi przy `analiza_eksport` i `audyt_eksport`.
   */
  app.get("/api/obsluga/zwroty/csv", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const zwroty = listaZwrotow(db());
    const s = sesjaZadania();
    logEvent("zwroty_eksport", s?.user.name ?? "?", null,
      { zwrotow: zwroty.length }, s?.user.userId ?? null, db());
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="wertis-zwroty.csv"')
      .send(csvZwrotow(zwroty));
  });

  app.get<{ Params: { id: string } }>("/api/obsluga/zwroty/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const id = Number(req.params.id);
    const zwrot = listaZwrotow(db()).find((z) => z.id === id);
    if (!zwrot) return reply.code(404).send({ error: "Nie znaleziono zwrotu" });
    /* Kandydatów liczymy TYLKO wtedy, gdy dokumentu jeszcze nie ma. Przy
       zwrocie z dokumentem lista nie ma komu służyć, a przebiega okno
       sześćdziesięciu dni sprzedaży. */
    const kandydaci = zwrot.faktura.dokId === null ? kandydaciFaktury(id, db()) : [];
    return {
      zwrot, os: osZwrotu(db(), id), kandydaciFaktury: kandydaci,
      /* Stan zapisu do Allegro (0.190.0). Liczy go SERWER, bo to on zna
         przeszkody: brak identyfikatora płatności, pobranie, brak kwoty.
         Panel powtarzający tę regułę rozjechałby się z nią przy pierwszej
         zmianie — a rozjazd znaczyłby tu przycisk obiecujący pracę, której
         serwer nie przyjmie. */
      pieniadze: stanZwrotuPieniedzy(db(), id),
      /* Czego jeszcze z tego zamówienia nie ma w zwrocie. Liczone tutaj,
         a nie w kolejce: lista jest potrzebna dopiero przy otwartym zwrocie. */
      doDopisania: doDopisania(id, db()),
    };
  });

  /* Wskazanie dokumentu sprzedaży przez człowieka (0.174.0). `dokId: null`
     ZDEJMUJE powiązanie i to jest droga wyjścia z pomyłki, a nie brak funkcji
     (§25a.5 — cofnięcie zamiast potwierdzenia).

     Bez `autoryzuj()`: to zwykła praca biura, nie operacja uprzywilejowana —
     ten sam argument co przy potwierdzeniu kartoteki wyżej. */
  app.post<{ Params: { id: string }; Body: { dokId?: number | null } }>(
    "/api/obsluga/zwroty/:id/faktura", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const dokId = req.body?.dokId == null ? null : Number(req.body.dokId);
      if (dokId !== null && !Number.isInteger(dokId)) {
        return reply.code(400).send({ error: "Zły identyfikator dokumentu" });
      }
      try {
        return { faktura: wskazFakture(db(), Number(req.params.id), dokId, kto()) };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    });
}
