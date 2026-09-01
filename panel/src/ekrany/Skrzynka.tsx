import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Towar } from "../wyszukiwarka";
import { Konflikt } from "../api/klient";
import { useJa, usePrzejmij, useRozmowa, useRozmowy, useZapiszSzkic, useZlecPomiar } from "../api/rozmowy";
import { useSzynaZdarzen } from "../api/zdarzenia";
import { Blad } from "../ui";
import { Kolejka } from "../skrzynka/Kolejka";
import { Rozmowa } from "../skrzynka/Rozmowa";

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
  const zapisz = useZapiszSzkic();
  const zlec = useZlecPomiar();

  const [szkic, setSzkic] = useState("");
  const [zrodlo, setZrodlo] = useState<number | null>(null);
  const [wskazowka, setWskazowka] = useState("");
  const [towar, setTowar] = useState<Towar | null>(null);
  const [nowa, setNowa] = useState(false);
  const [blad, setBlad] = useState("");

  useSzynaZdarzen(wybranaId, () => setNowa(true));

  /* Szkic wchodzi do pola przy zmianie ROZMOWY, nie przy każdym odczycie:
     nadpisywanie go w trakcie pisania kasowałoby pracę agenta. */
  useEffect(() => {
    setSzkic(rozmowa.data?.szkic?.body ?? "");
    setZrodlo(null); setWskazowka(""); setTowar(null); setNowa(false); setBlad("");
  }, [wybranaId, rozmowa.data?.rozmowa.id]);

  const zglos = (e: unknown) =>
    setBlad(e instanceof Konflikt ? `${e.message} — odśwież rozmowę` : (e as Error).message);

  return <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
    <Kolejka
      rozmowy={lista.data?.rozmowy ?? []}
      stan={lista.data?.stan ?? { ostatniaSynchronizacja: null, bledy: 0 }}
      wybranaId={wybranaId}
      laduje={lista.isLoading}
      onOdswiez={() => lista.refetch()}
      onWybierz={(x) => nawiguj(`/obsluga/skrzynka/${x}`)} />

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
        { onError: zglos })}
      onPokazNowa={() => { setNowa(false); rozmowa.refetch(); }}
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
      onZlec={() => {
        if (!rozmowa.data || !zrodlo) return;
        zlec.mutate({
          rozmowaId: rozmowa.data.rozmowa.id, wiadomoscId: zrodlo,
          instrukcja: wskazowka, twId: towar ? towar.id : null,
        }, { onError: zglos, onSuccess: () => { setZrodlo(null); setWskazowka(""); setTowar(null); } });
      }} />

    <div className="lg:col-span-2"><Blad>{blad || (lista.error as Error | null)?.message}</Blad></div>
  </div>;
}
