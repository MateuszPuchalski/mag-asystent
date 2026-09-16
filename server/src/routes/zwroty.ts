import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania, subiekt } from "../context.js";
import { autoryzuj } from "../services/auth.js";
import { transaction } from "../db/db.js";
import { db } from "../db/db.js";
import {
  koszykiCzekajaceNaKorekty, otwarteKoszyki, skladDoZaznaczenia, wypuscMmMimoKorekt,
  zamknijKosz, zaznaczSkladnik,
  dolozTowar, zdejmijTowar,
} from "../services/kosze-zwrotow.js";
import { towarZKodu } from "../services/kosze.js";
import { wierszeDokumentuZwrotu } from "../services/komplety.js";
import {
  bilansKartotek, cofnijKorekte, cofnijKwote, cofnijWerdykt, csvZwrotow, licznikiKubelkow, listaZwrotow, ocenPozycje, osZwrotu,
  potwierdzKartoteke, rozstrzygnijZwrot, zapiszIloscZwrocona, zapiszKorekte, zapiszKwote,
  zapiszPotracenie,
  zarejestrujNieodebrana,
  znajdzZwrotPoKodzie,
  ZwrotConflict,
  dopiszPozycje, doDopisania, usunDopisanaPozycje,
  zapiszNotatkeZwrotu, cofnijNotatkeZwrotu, stempelProwadziZwrot,
  wskazSklad,
} from "../services/zwroty.js";
import { RabatConflict, zlozWniosekORabat } from "../services/rabaty.js";
import { odmowZwrotuPieniedzy as wyslijOdmowe, zglosRabat, zwrocPlatnosc } from "../adapters/allegro.http.js";
import {
  cofnijPrzelew, odmowZwrotuPieniedzy, stanZwrotuPieniedzy, zapiszPrzelew,
  zwrocPieniadze, ZwrotPieniedzyConflict,
} from "../services/zwrot-pieniedzy.js";
import { uzupelnijZamowienia } from "../services/allegro-zamowienia-sync.js";
import { paczkiKlienta } from "../services/zamowienia.js";
import { powiazZaleglosci } from "../services/wiazania.js";
import { kandydaciFaktury, wskazFakture } from "../services/faktury.js";
import { dociagnijZwrotPoLiscie, synchronizujAllegroZwroty } from "../services/allegro-zwroty-sync.js";
import { config } from "../config.js";
import { logEvent } from "../services/events.js";
import { stanZwrotowHealth } from "../services/allegro-zwroty-sync-state.js";
import { reconcile } from "../services/reconcile.js";
import { trasyTagowSprawy } from "./tagi.js";
import { TAGI_ZWROTU } from "../services/tagi-spraw.js";

/* ── Trasy zwrotów klienckich (0.150.0, decyzje biura od 0.156.0) ────────────
   SZEŚĆ ZAPISÓW: kartoteka pozycji, werdykt, ocena towaru, kwota oraz — od
   0.162.0 — numer korekty i jego cofnięcie. Korektę wystawia człowiek
   w Subiekcie, a panel zapisuje FAKT, że powstała.

   Do Allegro wychodzą od 0.190.0 zwrot pieniędzy i odmowa wypłaty, a od
   0.164.0 wniosek o rabat. Zdanie „pieniądze oddaje w panelu Allegro" stało
   tu do audytu z 15 września 2026 — dwadzieścia wydań po tym, jak przestało
   być prawdą.

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

/* Które rozjazdy rekoncyliacji należą do TEGO ekranu. Lista jawna, nie prefiks
   nazwy: `kosz_bez_powrotu` dotyczy zwrotów, choć nie nosi tego w nazwie, a
   dopisanie piątej kontroli ma być decyzją, nie skutkiem ubocznym nazewnictwa. */
const RODZAJE_ZWROTOW = new Set([
  "zwrot_po_terminie", "zwrot_bez_przelewu", "kosz_czeka_na_korekte", "kosz_bez_powrotu",
]);

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

  /* Ręczna synchronizacja zwrotów (§9, wzorzec ze skrzynki i reklamacji).

     Zgłoszenie właściciela: „dodaj przycisk do synchronizacji zwrotów". Takt
     zwrotów chodzi rzadziej niż skrzynka — zwrot ma termin w dniach, pytanie
     klienta czeka na odpowiedź — więc po nadaniu paczki biuro czekało na
     nowy zwrot nawet kilkanaście minut, patrząc na listę, która niczego nie
     mówi o tym, czy jest kompletna.

     PRZERWY, O KTÓRĄ POPROSIŁO ALLEGRO, PRZYCISK NIE OMIJA. Ale gate stoi na
     KODZIE 429, nie na samej dacie kolejnej próby: `next_attempt_at` zapisuje
     się także po sukcesie (jako „za jeden takt"), więc warunek po samej dacie
     wyłączałby przycisk przez większość doby. Agent klika wtedy, gdy najbardziej
     mu zależy — czyli dokładnie w środku limitu, gdyby limit trwał.

     Wiązanie zaległości jak przy dociąganiu zamówień (0.220.0): kto klika,
     chce zobaczyć AKTUALNY stan, a nie jego połowę. */
  app.post("/api/obsluga/zwroty/synchronizuj", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    if (!config.allegro.clientId) {
      return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
    }
    const przed = stanZwrotowHealth(db());
    if (przed.kodOstatniegoBledu === 429 && przed.nastepnaProba
        && Date.parse(przed.nastepnaProba) > Date.now()) {
      return reply.code(409).send({
        error: "Allegro prosi o przerwę — synchronizacja czeka",
        nastepnaProba: przed.nastepnaProba,
      });
    }
    const s = sesjaZadania()!;
    logEvent("zwroty_synchronizacja_reczna", s.user.name);
    try {
      await synchronizujAllegroZwroty();
      return { stan: stanZwrotowHealth(db()), ...powiazZaleglosci(db()) };
    } catch (e) {
      /* Zdanie z adaptera mówi, co naprawić — token, uprawnienie, limit —
         więc jedzie na ekran w całości. Sam kod HTTP nie mówi nic. Zaległość
         wiąże się mimo to: z odpowiedzią Allegro nie ma nic wspólnego. */
      return reply.code(502).send({
        error: (e as Error).message,
        stan: stanZwrotowHealth(db()), ...powiazZaleglosci(db()),
      });
    }
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
      /* `ignorujBrak`: ten przycisk pyta o WSZYSTKO, także o numery, które
         Allegro odesłało już z 404. Pamięć negatywu zamyka pętlę tickera
         i tylko jego — przycisk istnieje po to, żeby rozstrzygnąć, czy
         problem jest w danych, czy w kodzie, a taki, który przez tydzień
         cicho oddaje `pobrano: 0`, nie rozstrzyga niczego. Ryzyka pętli tu
         nie ma: klika człowiek, a limit `NA_PRZEBIEG` obowiązuje tak samo. */
      const pobrano = await uzupelnijZamowienia({ ignorujBrak: true });
      /* Powiązanie ZARAZ PO dociągnięciu: to zamówienie niesie sygnaturę,
         więc dopiero teraz jest z czego wiązać. Bez tego operator klikałby
         „dociągnij" i dalej patrzył na „Bez kartoteki" do następnego taktu.
         Korekty i koszyki tą samą drogą (0.201.0): kto klika „dociągnij",
         chce zobaczyć AKTUALNY stan, a nie jego część. */
      return { pobrano, ...powiazZaleglosci(db()) };
    } catch (e) {
      /* WIĄŻEMY TAKŻE PO BŁĘDZIE (0.220.0). Ten przycisk jest jedyną ręczną
         drogą do wiązania, a zaległość w bazie nie ma nic wspólnego z tym,
         czy Allegro właśnie odpowiedziało. Odmowa dociągnięcia zostaje
         odmową — treść błędu jedzie na ekran jak dotąd. */
      return reply.code(400).send({
        error: (e as Error).message, pobrano: 0, ...powiazZaleglosci(db()),
      });
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

  /* Cofnięcie PRZYJĘCIA (0.204.0). Osobna trasa, nie `werdykt` z pustą
     decyzją: ta przyjmuje wyłącznie dwie wartości i ma tak zostać, żeby
     literówka w ciele nie wyzerowała werdyktu po cichu. Bramki — odmowa,
     oddane pieniądze, ustawione oceny — zna serwis, nie trasa. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/:id/werdykt/cofnij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return cofnijWerdykt(db(), Number(req.params.id), Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { ocena?: string | null; wersja?: number } }>(
    "/api/obsluga/zwroty/pozycje/:id/ocena", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const o = req.body?.ocena ?? null;
      /* „Przecena" zeszła w 0.209.0 — patrz `ocenPozycje`. Panel, który jej
         jeszcze nie zdjął, ma dostać 400 z wymienionymi ocenami, a nie cichy
         zapis wartości, której baza już nie zna. */
      if (o !== null && !["stan", "utylizacja"].includes(o)) {
        return reply.code(400).send({ error: "Ocena to `stan`, `utylizacja` albo brak." });
      }
      try {
        return ocenPozycje(db(), Number(req.params.id), o as never,
          Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* Ręczne wskazanie składu kompletu (0.336.0). Zgłoszenie właściciela:
     „rozwiąż «nie weszła do koszyka» — nie wiem, gdzie to wskazać".

     Automat sam odsyłał do tej drogi zdaniem „wskaż skład ręcznie", a drogi
     nie było: odejmowanie z paragonu wymaga, żeby każda POZOSTAŁA oferta
     zamówienia miała kartotekę, a te wypełniają się dopiero przy zwrocie.

     Bramka ta sama co przy ocenie i kartotece: samo `odmowa()`. To praca
     biura nad własnym magazynem, nie operacja wysyłająca cokolwiek na
     zewnątrz. */
  app.post<{
    Params: { id: string };
    Body: { skladniki?: Array<{ twId?: number; naKomplet?: number }> };
  }>("/api/obsluga/zwroty/pozycje/:id/sklad", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const skladniki = (req.body?.skladniki ?? []).map((s) => ({
      twId: Number(s?.twId), naKomplet: Number(s?.naKomplet),
    }));
    try {
      return wskazSklad(db(), Number(req.params.id), skladniki, kto());
    } catch (e) {
      /* Odmowa serwisu jest ZDANIEM dla człowieka („kartoteki 77 nie ma
         w kopii Subiekta"), a nie kodem — panel pokazuje ją wprost. */
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /* Ptaszek przy składniku kompletu (0.335.0). Zgłoszenie właściciela:
     „powinno rozbijać na komponenty do zaznaczania, które idą do MM".

     JEDNA TRASA NA OBA KIERUNKI, bo to przełącznik — dwie kazałyby panelowi
     wiedzieć, co dziś stoi w koszyku, zanim kliknie. Ciało niesie `wKoszyku`,
     czyli stan DOCELOWY, a nie czynność.

     Bramka ta sama co przy ocenie: samo `odmowa()`, bez `autoryzuj()`.
     Przesunięcie towaru między własnymi magazynami to codzienna praca biura,
     a nie operacja, po której coś opuszcza firmę. */
  app.post<{ Params: { id: string }; Body: { twId?: number; wKoszyku?: boolean } }>(
    "/api/obsluga/zwroty/pozycje/:id/skladnik", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const twId = Number(req.body?.twId);
      if (!Number.isFinite(twId) || twId <= 0) {
        return reply.code(400).send({ error: "Brak numeru kartoteki (`twId`)." });
      }
      try {
        return {
          sklad: zaznaczSkladnik(db(), Number(req.params.id), twId,
            req.body?.wKoszyku === true, kto()),
        };
      } catch (e) {
        /* Odmowa serwisu jest ZDANIEM dla człowieka („koszyk Z-3 ma już
           dokument"), a nie kodem — panel pokazuje ją wprost. */
        return reply.code(400).send({ error: (e as Error).message });
      }
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
      /* DWA koszyki od 0.211.0 — zwroty i odpad. Lista, nie pole: trzeci
         rodzaj (przecena?) nie ma wtedy zmieniać kształtu odpowiedzi. */
      kosze: otwarteKoszyki(db(), kto()),
      czekajace: koszykiCzekajaceNaKorekty(db()),
    };
  });

  /* ── Towar dołożony ręką: skan albo kartoteka (0.365.0) ──────────────────
     Zgłoszenie właściciela: „dodaj możliwość dodawania produktów do koszyka
     zwrotowego poprzez zeskanowanie produktu lub wybranie go z kartoteki".

     JEDNA TRASA NA OBIE DROGI, bo to jedno pytanie: „który to towar". Kod
     z czytnika rozpoznaje ta sama drabinka co na kolektorze (EAN, alias EAN,
     symbol) i wtedy odpowiedź jest JEDNA i oznaczona `dokladne`. Gdy kod nie
     pasuje do niczego, pytanie zamienia się w szukanie po kartotece — z tą
     samą furtką na literówki, z której korzysta karta towaru.

     Odczyt bez zapisu: dziennik dostaje dopiero dołożenie. Zapisywanie każdej
     wpisanej litery robiłoby z pola szukania rejestr ruchów operatora. */
  app.get<{ Querystring: { q?: string } }>(
    "/api/obsluga/zwroty/kosz/towary", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const q = String(req.query?.q ?? "").trim();
      if (!q) return { towary: [], dokladne: false, przyblizone: false };

      const zeSkanu = towarZKodu(q);
      if (zeSkanu) {
        return {
          /* Stan przy trafieniu ze skanu zostaje `null` i to nie jest brak
             danych: kod z czytnika ROZSTRZYGA, który to towar, a liczba na
             magazynie pomaga dopiero przy wybieraniu z listy. */
          towary: [{
            twId: zeSkanu.tw_id, symbol: zeSkanu.symbol, nazwa: zeSkanu.nazwa,
            ean: zeSkanu.ean || null, stanMag: null,
          }],
          dokladne: true, przyblizone: false,
        };
      }
      const { wyniki, przyblizone } = subiekt.szukajZFurtka(q, 20);
      return {
        towary: wyniki.map((t) => ({
          twId: t.id, symbol: t.sym, nazwa: t.name, ean: t.ean || null, stanMag: t.mag,
        })),
        dokladne: false, przyblizone,
      };
    });

  app.post<{ Body: { twId?: number; ilosc?: number; rodzaj?: string } }>(
    "/api/obsluga/zwroty/kosz/towar", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const twId = Number(req.body?.twId);
      if (!Number.isFinite(twId) || twId <= 0) {
        return reply.code(400).send({ error: "Wskaż towar — ze skanu albo z listy." });
      }
      /* Rodzaj koszyka z ciała, bo operator ma przy biurku dwa pudła: zwroty
         i odpad. Wartość spoza pary jest odmową, nie cichym „zwroty": złom
         wpuszczony na regał zwrotów wróciłby do sprzedaży. */
      const rodzaj = req.body?.rodzaj ?? "zwroty";
      if (rodzaj !== "zwroty" && rodzaj !== "odpad") {
        return reply.code(400).send({ error: "Koszyk jest albo zwrotów, albo odpadu." });
      }
      try {
        return dolozTowar(db(), twId, Number(req.body?.ilosc ?? 1), kto(), new Date(), rodzaj);
      } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
    });

  app.post<{ Body: { pozycjaId?: number } }>(
    "/api/obsluga/zwroty/kosz/towar/zdejmij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const id = Number(req.body?.pozycjaId);
      if (!Number.isFinite(id) || id <= 0) {
        return reply.code(400).send({ error: "Wskaż pozycję, którą mam zdjąć." });
      }
      try {
        return zdejmijTowar(db(), id, kto());
      } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
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

  /* WYPUSZCZENIE MM MIMO BRAKUJĄCYCH KOREKT (0.368.0). Decyzja właściciela:
     „dodaj opcję sforsowania zamknięcia koszyka, nawet jeśli nie ma wszystkich
     ZW". Bramka z 0.200.0 zostaje domyślna — to jest wyjście awaryjne obok
     niej, nie jej zdjęcie.

     OSOBNA TRASA, nie flaga przy `zamknij`. Flaga w ciele robi z wyjątku
     wariant zwykłej czynności: jedno pole więcej w żądaniu, które łatwo
     ustawić przez pomyłkę i którego nie widać w dzienniku żądań. Osobny adres
     jest widoczny w kodzie panelu, w logu i w tej liście tras — a ta decyzja
     ma być widoczna, bo płaci za nią magazyn.

     Bramka roli ta sama co przy zamykaniu, bez `autoryzuj()`: to przesunięcie
     między własnymi magazynami, jak zamknięcie koszyka. Nic nie opuszcza
     firmy i nic nie rusza cudzych pieniędzy. */
  app.post<{ Body: { koszId?: number } }>(
    "/api/obsluga/zwroty/kosz/mm-mimo-korekt", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const id = Number(req.body?.koszId);
      if (!Number.isFinite(id) || id <= 0) {
        return reply.code(400).send({ error: "Podaj koszyk, dla którego mam wystawić MM." });
      }
      try {
        return wypuscMmMimoKorekt(db(), id, kto());
      } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
    });

  /* Co ten klient u nas kupił (0.365.0). Odpowiedź na zgłoszenie właściciela:
     „kupujący może mieć wiele paczek kupionych w historii sklepu, więc muszę
     mieć możliwość wybrania paczki". Rejestracja nieodebranej pytała o numer
     zamówienia jak o rzecz oczywistą, a to jedyna rzecz, której przy takiej
     paczce nie ma pod ręką.

     ODCZYT, nie dociąganie: trasa czyta wyłącznie to, co synchronizacja już
     przyniosła. Pytanie do Allegro ma tu własny przycisk i własny limit, a ta
     lista odświeża się po dopisaniu uchwytu, nie po każdym znaku.

     Konto bierzemy PIERWSZE, tak samo jak rejestracja niżej — dwie różne
     zasady dawałyby listę z jednego konta i wiersz zapisany na drugim.

     POST, CHOĆ NIC NIE ZAPISUJE (0.367.0) — ta sama decyzja i to samo
     uzasadnienie co przy `/skan` z 0.163.0. Do 0.366.0 uchwyt jechał
     w adresie (`?login=`), a od tego wydania bywa nim NAZWISKO Z NAKLEJKI:
     adres ląduje w logu żądań serwera, więc dana osobowa pojechałaby do pliku,
     którego polityka zwrotów nie obejmuje. Ciało żądania do loga nie wchodzi.

     ŚLAD ZOSTAJE, bo to odczyt cudzej danej osobowej — precedens `zwroty_eksport`
     niżej. W dzienniku stoi LICZBA trafień i rodzaj uchwytu, nigdy sam uchwyt:
     zdarzenie odpowiada na pytanie „kto i kiedy przeglądał", a nie „czego
     szukał". */
  app.post<{ Body: { szukane?: string } }>(
    "/api/obsluga/zwroty/paczki-klienta", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const szukane = String(req.body?.szukane ?? "").trim();
      const konto = db().prepare("SELECT id FROM channel_account ORDER BY id LIMIT 1")
        .get() as { id: number } | undefined;
      if (!konto || !szukane) return { paczki: [] };
      const paczki = paczkiKlienta(konto.id, szukane, db());
      logEvent("zwrot_paczki_klienta", kto().name, null,
        { trafien: paczki.length, dlugosc: szukane.length }, kto().id, db());
      return { paczki };
    });

  /* Paczka, której klient nie odebrał (0.172.0). Allegro takiego bytu nie zna,
     więc wiersz zakłada BIURO — i to jest jedyna trasa zwrotów tworząca zwrot
     od zera. Pieniądze i tak trzeba oddać, więc idzie tą samą kolejką, ale
     `zrodlo` mówi wprost, że to nie zgłoszenie klienta. */
  app.post<{ Body: {
    waybill?: string; orderId?: string | null; notatka?: string | null; login?: string | null;
    odbiorcaNazwa?: string | null; przewoznik?: string | null;
  } }>(
    "/api/obsluga/zwroty/nieodebrana", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return zarejestrujNieodebrana(db(), {
          waybill: String(req.body?.waybill ?? ""),
          orderId: req.body?.orderId ?? null,
          notatka: req.body?.notatka ?? null,
          /* Login kupującego (0.365.0) — przy nieodebranej to często jedyny
             uchwyt, po którym biuro wróci do tej paczki. Serwer przycina go
             i chowa w kolumnie zwrotu; walidacji kształtu nie ma, bo Allegro
             nie zamyka listy dopuszczalnych loginów. */
          login: req.body?.login ?? null,
          /* Nazwa odbiorcy i przewoźnik Z NAKLEJKI (0.367.0). Numeru listu
             z wracającej paczki nasz system nie widział nigdy — paczki nakleja
             klient albo kurier — więc to jedyne dwa uchwyty, które zostają po
             tym, jak pierwszy skan chybi. Serwer przycina je i chowa
             w kolumnach zwrotu; walidacji kształtu nie ma, bo naklejki nie
             wypisuje Allegro. */
          odbiorcaNazwa: req.body?.odbiorcaNazwa ?? null,
          przewoznik: req.body?.przewoznik ?? null,
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

  /* Ile sztuk NAPRAWDĘ wróciło (0.212.0). Liczy biuro przy rozpakowaniu —
     decyzja właściciela. Widełki i bramkę „najpierw przyjmij" zna serwis:
     zależą od deklaracji klienta i od stanu zwrotu, a trasa żadnego z nich
     nie zna. */
  app.post<{ Params: { id: string }; Body: { ilosc?: number | null; wersja?: number } }>(
    "/api/obsluga/zwroty/pozycje/:id/ilosc", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const i = req.body?.ilosc;
      if (i !== null && i !== undefined && typeof i !== "number") {
        return reply.code(400).send({ error: "Liczba sztuk to liczba albo brak." });
      }
      try {
        return zapiszIloscZwrocona(db(), Number(req.params.id), i ?? null,
          Number(req.body?.wersja), kto());
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

  /* Cofnięcie kwoty stoi za samym `odmowa()`, bez `autoryzuj()` — to ta sama
     praca biura co jej zapis, a nic nie opuszcza firmy. Bramki, które są tu
     naprawdę potrzebne (oddane pieniądze, zapisana korekta), pilnuje serwis:
     zna stan zwrotu, a trasa go nie zna. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/:id/kwota/cofnij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return cofnijKwote(db(), Number(req.params.id), Number(req.body?.wersja), kto());
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

  /* ── Przelew oddany poza Allegro (0.269.0) ─────────────────────────────────
     Przy pobraniu Allegro nie trzymało pieniędzy, więc trasa wyżej jest
     zamknięta z definicji, a zwrot zamykał się bez śladu po wypłacie. Te dwie
     trasy zapisują NOTATKĘ o przelewie i ją cofają.

     BEZ `autoryzuj()`, inaczej niż zwrot przez Allegro. Tamta trasa RUSZA
     cudze pieniądze; ta zapisuje, że ruszył je człowiek w banku. Bramka roli
     zostaje, bo to dane sprawy klienta — ale wpis `privileged` przy notatce
     zrównywałby ją z przelewem i nauczyłby przewijać dziennik. */
  app.post<{ Params: { id: string }; Body: { wersja?: number; referencja?: string } }>(
    "/api/obsluga/zwroty/:id/przelew", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return zapiszPrzelew(db(), Number(req.params.id), Number(req.body?.wersja),
          kto(), req.body?.referencja ?? null);
      } catch (e) {
        if (e instanceof ZwrotPieniedzyConflict) {
          return reply.code(409).send({ error: e.message });
        }
        return reply.code(400).send({ error: (e as Error).message });
      }
    });

  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/:id/przelew/cofnij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return cofnijPrzelew(db(), Number(req.params.id), Number(req.body?.wersja), kto());
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
  /* ── PROWADZĄCY ZWROT (0.315.0) ─────────────────────────────────────────
     Jedna trasa na wzięcie i oddanie: to PRZEŁĄCZNIK, a nie dwie decyzje.
     Druga trasa kazałaby panelowi wiedzieć, czyj jest znacznik, zanim
     kliknie — a to wie serwer, i tylko on wie na pewno.

     Bez `autoryzuj()`: znacznik nie rusza ani pieniędzy, ani stanów. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/:id/prowadzi", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return stempelProwadziZwrot(db(), Number(req.params.id), kto(), req.body?.wersja);
      } catch (e) { return konflikt(reply, e); }
    });

  /* Tagi zwrotu — ten sam rejestrator co przy reklamacjach i dyskusjach,
     tylko z inną osią wiązań. Słownik jest jeden dla wszystkich trzech. */
  trasyTagowSprawy(app, "/api/obsluga/zwroty", TAGI_ZWROTU);

  /* ── NOTATKA BIURA (0.313.0) ────────────────────────────────────────────
     Bez `autoryzuj()`: to zdanie zostaje U NAS i niczego nie obiecuje
     klientowi — czyli zwykła praca biura, tak samo jak zapis przelewu.

     Bramka wersji siedzi w serwisie i NIE odmawia przy zwrocie zamkniętym.
     Notatkę najczęściej dopisuje się właśnie po zamknięciu, gdy sprawa wraca
     pytaniem; bramka na stanie końcowym kazałaby wybierać między poprawną
     kolejnością pracy a zapisaniem ustalenia. */
  app.post<{ Params: { id: string }; Body: { notatka?: string | null; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/notatka", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const n = req.body?.notatka;
      if (n !== null && n !== undefined && typeof n !== "string") {
        return reply.code(400).send({ error: "Pole `notatka` musi być tekstem albo `null`" });
      }
      try {
        return zapiszNotatkeZwrotu(db(), Number(req.params.id), n ?? null, kto(),
          req.body?.wersja);
      } catch (e) { return konflikt(reply, e); }
    });

  /* Cofnięcie zamiast potwierdzenia (§25a.5) — notatka jest polem swobodnym,
     które nadpisuje ten, kto pisze ostatni. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/:id/notatka/cofnij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return cofnijNotatkeZwrotu(db(), Number(req.params.id), kto(), req.body?.wersja);
      } catch (e) { return konflikt(reply, e); }
    });

  /* ── ROZJAZDY ZWROTÓW (0.313.0) ─────────────────────────────────────────
     Rekoncyliacja zna cztery kontrole dotyczące zwrotów i rysowała je
     WYŁĄCZNIE w `/biuro`, czyli nie tam, gdzie pracuje obsługa. Raport, który
     trzeba otworzyć na drugim ekranie, nie chroni przed niczym.

     WĄSKA TRASA, a nie `/api/reconcile` z `routes/device.ts`: tamta nie ma
     bramki ról i niesie całą halę razem z lokalizacjami kartotek. Panel
     obsługi ma dostać to, co jego, i nic poza tym. */
  app.get("/api/obsluga/zwroty/rozjazdy", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    return {
      rozjazdy: reconcile().rozjazdy.filter((r) => RODZAJE_ZWROTOW.has(r.rodzaj)),
    };
  });

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
    /* Filtr po identyfikatorze, nie `.find` po całej historii (audyt zwrotów,
       15 września 2026) — koszt i powód stoją przy `listaZwrotow`. */
    const jeden = listaZwrotow(db(), Date.now(), { id });
    const zwrot = jeden.length ? jeden[0] : null;
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
      /* CO NAPRAWDĘ WEJDZIE DO KOSZYKA (0.328.0). Komplet sprzedany jedną
         ofertą leży na magazynie osobno, a rozbicie ma tylko paragon.

         TYLKO W SZCZEGÓLE, nigdy w kolejce: `skladPozycji` pyta o dokument,
         o zamówienie i o mapowanie każdej oferty, a kolejka liczy naraz
         wszystkie zwroty. Ta sama zasada co przy liście wyżej. */
      /* Z ZAZNACZENIEM (0.335.0): ekran ma pokazać nie tylko CO wejdzie, ale
         i co już leży w koszyku — inaczej ptaszek rysowałby się z nadziei. */
      sklady: Object.fromEntries(
        zwrot.pozycje.map((p) => [p.id, skladDoZaznaczenia(db(), p.id)])),
      /* Wiersze paragonu — materiał do RĘCZNEGO składu (0.336.0). Jeden raz na
         zwrot, nie raz na pozycję: dokument jest jeden, a kopiowanie go przy
         każdej pozycji rozdęłoby odpowiedź o to samo. */
      wierszeDokumentu: wierszeDokumentuZwrotu(db(), id),
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
