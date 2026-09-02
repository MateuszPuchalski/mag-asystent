import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Towar } from "../wyszukiwarka";
import { Konflikt } from "../api/klient";
import {
  useAgenci, useDodajKomentarz, useDolaczDoSprawy, useJa, useOdlaczOdSprawy, usePrzejmij,
  usePrzekaz, useRozmowa, useSprawy, useZalozSprawe,
  useRozmowy, useSynchronizuj, useUchwytRozmowy, useUstawStatus, useWskazOferte, useWyslij,
  useZapiszSzkic, useZdrowie, useZlecPomiar,
} from "../api/rozmowy";
import { useSzynaZdarzen } from "../api/zdarzenia";
import { Blad } from "../ui";
import { Kolejka } from "../skrzynka/Kolejka";
import { Rozmowa } from "../skrzynka/Rozmowa";
import { Kontekst } from "../skrzynka/Kontekst";
import { AlarmSynchronizacji } from "../skrzynka/AlarmSynchronizacji";
import type { StatusRozmowy, SzczegolyKonfliktu, SzczegolyWysylki } from "../api/typy";
import { DialogKonfliktu } from "../skrzynka/DialogKonfliktu";

export function Skrzynka() {
  /* Wybrana rozmowa siedzi w ADRESIE, nie w stanie komponentu. Do 0.146.0
     panel zapisywał `?rozmowa=N` przez `history.replaceState` i nigdy tego
     nie odczytywał, więc odświeżenie strony gubiło wybór. */
  const { id } = useParams<{ id: string }>();
  const wybranaId = id ? Number(id) : null;
  const nawiguj = useNavigate();

  const ja = useJa();
  const lista = useRozmowy();
  const rozmowa = useRozmowa(wybranaId);
  const przejmij = usePrzejmij();
  const przekaz = usePrzekaz();
  const oferta = useWskazOferte();
  const zdrowie = useZdrowie();
  const synchronizuj = useSynchronizuj();
  const wyslij = useWyslij();
  const zapisz = useZapiszSzkic();
  const zlec = useZlecPomiar();

  const status = useUstawStatus();
  const sprawy = useSprawy();
  const zalozSprawe = useZalozSprawe();
  const dolaczDoSprawy = useDolaczDoSprawy();
  const odlaczOdSprawy = useOdlaczOdSprawy();
  const agenci = useAgenci();
  const dodajKomentarz = useDodajKomentarz();

  const [szkic, setSzkic] = useState("");
  /* Komentarz ma WŁASNY stan, osobny od szkicu. Gdyby dzieliły jeden, notatka
     „klient bywa trudny" zostawałaby w szkicu po przełączeniu trybu i czekała
     na kliknięcie WYŚLIJ (§6.4). */
  const [komentarz, setKomentarz] = useState("");
  const [wzmianki, setWzmianki] = useState<number[]>([]);
  const [zrodlo, setZrodlo] = useState<number | null>(null);
  const [wskazowka, setWskazowka] = useState("");
  const [towar, setTowar] = useState<Towar | null>(null);
  const [nowa, setNowa] = useState(false);
  const [blad, setBlad] = useState("");
  const [konflikt, setKonflikt] = useState<SzczegolyKonfliktu | null>(null);
  const [bladKonfliktu, setBladKonfliktu] = useState("");
  const [bladOferty, setBladOferty] = useState("");
  const [bladSynchronizacji, setBladSynchronizacji] = useState("");
  const [konfliktWysylki, setKonfliktWysylki] = useState<SzczegolyWysylki | null>(null);
  const [bladWysylki, setBladWysylki] = useState("");
  const [bladStatusu, setBladStatusu] = useState("");
  const [bladSprawy, setBladSprawy] = useState("");
  const [przyRozmowie, setPrzyRozmowie] = useState<string | null>(null);

  useSzynaZdarzen(wybranaId, () => setNowa(true));
  /* Samo wejście w pytanie trzyma je dla tego agenta — do wyjścia albo do
     odpowiedzi, która przydziela je na stałe (decyzja właściciela, 0.159.0). */
  useUchwytRozmowy(wybranaId);

  /* Szkic wchodzi do pola przy zmianie ROZMOWY, nie przy każdym odczycie:
     nadpisywanie go w trakcie pisania kasowałoby pracę agenta. */
  useEffect(() => {
    setSzkic(rozmowa.data?.szkic?.body ?? "");
    setZrodlo(null); setWskazowka(""); setTowar(null); setNowa(false); setBlad("");
    setKonflikt(null); setBladKonfliktu(""); setBladOferty("");
    setKonfliktWysylki(null); setBladWysylki(""); setBladStatusu(""); setBladSprawy(""); setPrzyRozmowie(null);
  }, [wybranaId, rozmowa.data?.rozmowa.id]);

  const zglos = (e: unknown) =>
    setBlad(e instanceof Konflikt ? `${e.message} — odśwież rozmowę` : (e as Error).message);

  /* Przegrany wyścig o przejęcie NIE jest zwykłym błędem: ekran ma pokazać
     właściciela, czas i obie wersje, a nie zamienić to w jedno zdanie. */
  const zglosPrzejecie = (e: unknown) => {
    if (e instanceof Konflikt) setKonflikt(e.szczegoly as SzczegolyKonfliktu);
    else setBlad((e as Error).message);
  };

  /* Kontrola świeżości porównuje ostatnią wiadomość KLIENTA, nie ostatnią
     w ogóle — inaczej własna odpowiedź blokowałaby kolejną w tej rozmowie. */
  const ostatniaKlienta = [...(rozmowa.data?.os ?? [])].reverse()
    .find((w) => w.rodzaj === "wiadomosc" && w.odKlienta)?.messageId ?? null;

  function wyslijOdpowiedz(mimoNowejWiadomosci = false, mimoObecnosci = false) {
    if (!rozmowa.data) return;
    setBladWysylki("");
    wyslij.mutate({
      id: rozmowa.data.rozmowa.id, body: szkic,
      expectedVersion: rozmowa.data.rozmowa.wersja,
      expectedLastMessageId: ostatniaKlienta, mimoNowejWiadomosci, mimoObecnosci,
    }, {
      onSuccess: (w) => {
        setKonfliktWysylki(null);
        setPrzyRozmowie(null);
        if (w.status === "sent") setSzkic("");
        else setBlad("Wysyłka nie dała jednoznacznej odpowiedzi — zsynchronizuj wątek.");
      },
      onError: (e) => {
        /* Dopisek klienta nie jest błędem do pokazania w pasku: ekran ma
           postawić dialog i poprosić o jawną zgodę. */
        if (e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).nowaWiadomosc !== undefined) {
          setKonfliktWysylki(e.szczegoly as SzczegolyWysylki);
        /* Drugi rodzaj konfliktu: przy rozmowie siedzi kto inny. Pytanie do
           agenta jest inne niż przy dopisku klienta, więc i pasek jest inny —
           a zgoda musi być jawna, tak samo jak tam. */
        } else if (e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).trzymajacyName) {
          setPrzyRozmowie((e.szczegoly as SzczegolyWysylki).trzymajacyName ?? "");
        } else if (konfliktWysylki) setBladWysylki((e as Error).message);
        else zglos(e);
      },
    });
  }

  const jestemAdminem = ja.data?.user.role === "admin";
  const alarm = Boolean(zdrowie.data?.allegroInbox.alarm);

  /* Ekran trzyma się okna, a przewijają się kolumny (0.165.0) — ten sam nawyk
     co w zwrotach, bo dwa ekrany obsługi mają mieć jeden, nie dwa.

     Alarm stoi POZA gridem: jako wiersz `col-span-2` byłby wierszem
     warunkowym, a wtedy kolumny wpadałyby w niego przy pustym alarmie
     i blokada by znikała.

     TABELA `StanIntegracji` odeszła stąd w 0.168.0 — za zębatkę, na ekran
     ustawień. Skrzynka jest ekranem pracy, a trzynaście wierszy z
     `/api/health` czyta się raz na tydzień. Alarm ZOSTAJE: zasada 10 projektu
     mówi „awaria integracji musi być widoczna", a §21 żąda trwałego alarmu —
     schowaniu podlegała tabela, nie ostrzeżenie. */
  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    <AlarmSynchronizacji zdrowie={zdrowie.data} trwa={synchronizuj.isPending}
      blad={bladSynchronizacji}
      synchronizuj={() => { setBladSynchronizacji(""); synchronizuj.mutate(undefined,
        { onError: (e) => setBladSynchronizacji((e as Error).message) }); }} />

    {/* Trzy kolumny (§10.1, 0.180.0), wzorcem z ekranu zwrotów: skrajne stałe,
        środek `minmax(0,1fr)`. Samo `1fr` to skrót od `minmax(auto,1fr)` —
        środek rozpychałby się ponad przydział, gdy oś dostanie długi wyraz.
        `lg:grid-rows-[minmax(0,1fr)]` trzyma wysokość: pojedynczy wiersz
        `auto` mierzy się do `max-content` i grid wylewa się poza okno. */}
    <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[22rem_minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)]">
    <Kolejka
      nieswieza={alarm}
      rozmowy={lista.data?.rozmowy ?? []}
      stan={lista.data?.stan ?? { ostatniaSynchronizacja: null, bledy: 0 }}
      wybranaId={wybranaId}
      mojeId={ja.data?.user.userId ?? null}
      laduje={lista.isLoading}
      onOdswiez={() => lista.refetch()}
      onWybierz={(x) => nawiguj(`/obsluga/skrzynka/${x}`)} />

    <div className="flex min-h-0 flex-col gap-4">
    {/* Uchwyt kolegi zatrzymuje wysyłkę, ale nigdy po cichu: zgoda jest jawna,
        tak samo jak przy dopisku klienta z 0.110.0. */}
    {przyRozmowie && <div className="card flex shrink-0 flex-wrap items-center gap-3 border-violet-300 bg-violet-50 p-3 text-sm">
      <span><b>{przyRozmowie}</b> siedzi teraz przy tej rozmowie.</span>
      <span className="text-slate-600">Dwie odpowiedzi na jedno pytanie to dwie różne prawdy u klienta.</span>
      <div className="ml-auto flex gap-2">
        <button type="button" className="btn-secondary text-sm"
          onClick={() => setPrzyRozmowie(null)}>Zostaw koledze</button>
        <button type="button" className="btn-primary text-sm" disabled={wyslij.isPending}
          onClick={() => wyslijOdpowiedz(false, true)}>Odpowiedz mimo to</button>
      </div>
    </div>}

    <Rozmowa
      dane={rozmowa.data}
      mojeId={ja.data?.user.userId ?? null}
      nowaWiadomosc={nowa}
      szkic={szkic}
      zapisuje={zapisz.isPending}
      zrodloPomiaru={zrodlo}
      wskazowka={wskazowka}
      towar={towar}
      onPrzejmij={() => rozmowa.data && przejmij.mutate(
        { id: rozmowa.data.rozmowa.id, expectedVersion: rozmowa.data.rozmowa.wersja },
        { onError: zglosPrzejecie, onSuccess: () => setKonflikt(null) })}
      onPokazNowa={() => { setNowa(false); rozmowa.refetch(); }}
      komentarz={komentarz}
      onKomentarz={setKomentarz}
      komentuje={dodajKomentarz.isPending}
      /* Komentowanie NIE wymaga prowadzenia rozmowy: notatka zespołu to nie
         odpowiedź do klienta. */
      onDodajKomentarz={() => rozmowa.data && dodajKomentarz.mutate(
        { rozmowaId: rozmowa.data.rozmowa.id, body: komentarz, mentionedUserIds: wzmianki },
        { onSuccess: () => { setKomentarz(""); setWzmianki([]); } })}
      agenci={(agenci.data?.users ?? [])
        .filter((u) => u.userId !== ja.data?.user.userId)
        .map((u) => ({ userId: u.userId, name: u.name }))}
      wzmianki={wzmianki}
      onWzmianki={setWzmianki}
      onSzkic={setSzkic}
      onZapiszSzkic={() => {
        if (!rozmowa.data) return;
        const ostatnia = [...rozmowa.data.os].reverse().find((w) => w.messageId)?.messageId ?? null;
        zapisz.mutate({
          id: rozmowa.data.rozmowa.id, body: szkic, expectedLastMessageId: ostatnia,
          expectedVersion: rozmowa.data.szkic?.wersja ?? null,
        }, { onError: zglos, onSuccess: () => setBlad("") });
      }}
      onZrodlo={setZrodlo}
      onWskazowka={setWskazowka}
      onTowar={setTowar}
      wysyla={wyslij.isPending}
      onWyslij={() => wyslijOdpowiedz(false)}
      onZlec={() => {
        if (!rozmowa.data || !zrodlo) return;
        zlec.mutate({
          rozmowaId: rozmowa.data.rozmowa.id, wiadomoscId: zrodlo,
          instrukcja: wskazowka, twId: towar ? towar.id : null,
        }, { onError: zglos, onSuccess: () => { setZrodlo(null); setWskazowka(""); setTowar(null); } });
      }}
      konflikt={konflikt}
      mozeWymusic={jestemAdminem}
      wymusza={przekaz.isPending}
      bladKonfliktu={bladKonfliktu}
      zapisujeOferte={oferta.isPending}
      bladOferty={bladOferty}
      onZamknijKonflikt={() => setKonflikt(null)}
      onPoprosOPrzekazanie={() => {
        /* Prośba o przekazanie to komentarz wewnętrzny, nie osobny mechanizm:
           właściciel czyta go w rozmowie, przy której siedzi. */
        if (!rozmowa.data) return;
        setSzkic(`@${konflikt?.assignedUserName ?? ""} — przejmiesz tę rozmowę? `.trimEnd());
        setKonflikt(null);
      }}
      onWymus={(powod) => {
        if (!rozmowa.data) return;
        setBladKonfliktu("");
        przekaz.mutate({
          id: rozmowa.data.rozmowa.id, doUserId: ja.data?.user.userId ?? null,
          powod, expectedVersion: konflikt?.version ?? rozmowa.data.rozmowa.wersja,
        }, { onSuccess: () => setKonflikt(null),
             onError: (e) => setBladKonfliktu((e as Error).message) });
      }}
      onWskazOferte={(ofertaId) => {
        if (!rozmowa.data) return;
        setBladOferty("");
        oferta.mutate({ id: rozmowa.data.rozmowa.id, ofertaId },
          { onError: (e) => setBladOferty((e as Error).message) });
      }}
      sprawy={sprawy.data?.sprawy ?? []}
      trwaSprawa={zalozSprawe.isPending || dolaczDoSprawy.isPending || odlaczOdSprawy.isPending}
      bladSprawy={bladSprawy}
      onZalozSprawe={(tytul) => {
        if (!rozmowa.data) return;
        setBladSprawy("");
        zalozSprawe.mutate({ tytul, rozmowaId: rozmowa.data.rozmowa.id },
          { onError: (e) => setBladSprawy((e as Error).message) });
      }}
      onDolaczDoSprawy={(sprawaId) => {
        if (!rozmowa.data) return;
        setBladSprawy("");
        dolaczDoSprawy.mutate({ sprawaId, rozmowaId: rozmowa.data.rozmowa.id },
          { onError: (e) => setBladSprawy((e as Error).message) });
      }}
      onOdlaczOdSprawy={() => {
        if (!rozmowa.data) return;
        setBladSprawy("");
        odlaczOdSprawy.mutate({ rozmowaId: rozmowa.data.rozmowa.id },
          { onError: (e) => setBladSprawy((e as Error).message) });
      }}
      onOtworzRozmowe={(x) => nawiguj(`/obsluga/skrzynka/${x}`)}
      zapisujeStatus={status.isPending}
      bladStatusu={bladStatusu}
      onZmienStatus={(nowy: StatusRozmowy, doKiedy) => {
        if (!rozmowa.data) return;
        setBladStatusu("");
        status.mutate({ id: rozmowa.data.rozmowa.id, status: nowy, doKiedy },
          { onError: (e) => setBladStatusu((e as Error).message) });
      }}
      onDopytajOOferte={() => setSzkic((s) => s
        || "Dzień dobry, proszę o numer oferty, której dotyczy pytanie — dobiorę wtedy właściwą część.")}
    />
    </div>

    {/* Trzecia kolumna. Bez rozmowy nie ma czego pokazać — kolumna znika,
        zamiast stać pusta i zabierać środkowi 340 px. */}
    {rozmowa.data && <Kontekst dane={rozmowa.data} />}
    </div>

    {/* Dialog jest `fixed`, ale jako dziecko gridu założyłby niejawny wiersz —
        a wtedy kolumny przestałyby się mieścić w oknie. */}
    {konfliktWysylki && <DialogKonfliktu
      szczegoly={konfliktWysylki} szkic={szkic} wysyla={wyslij.isPending} blad={bladWysylki}
      onWyslijMimoTo={() => wyslijOdpowiedz(true)}
      onPopraw={() => { setKonfliktWysylki(null); rozmowa.refetch(); }} />}

    <div className="shrink-0 space-y-4">
      <Blad>{blad || (lista.error as Error | null)?.message}</Blad>
    </div>
  </div>;
}
