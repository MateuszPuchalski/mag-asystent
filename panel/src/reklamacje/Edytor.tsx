import React from "react";
import type { ZalacznikSzkicu } from "../api/rozmowy";
import { Edytor as EdytorOdpowiedzi } from "../skrzynka/Edytor";

/* ── Edytor odpowiedzi w sprawie Allegro: USTAWIENIA, NIE KOPIA (0.549.0) ──
   Reklamacje i dyskusje odpowiadają tym samym edytorem co skrzynka, decyzją
   właściciela z 28 września. Osobny edytor sprawy rozjeżdżał się ze skrzynką
   przy każdym wydaniu, bo każdą poprawkę trzeba było pamiętać dwa razy.

   Ten plik trzyma tylko to, co w sprawie jest naprawdę inne:
   - napis „Wyślij odpowiedź”, bo rozmowa jest trójstronna i odbiorcą bywa
     doradca Allegro, więc „do klienta” bywałoby nieprawdą. Ekran reklamacji
     podaje „Wyślij do klienta”, bo tak mówi makieta właściciela;
   - sufit 20 000 znaków z `MessageRequest.text`, nie 2000 z Centrum
     Wiadomości, bo to inny zasób;
   - brak notatki z wzmiankami: sprawa ma własną notatkę w kolumnie faktów;
   - szkic żyje w sesji przeglądarki, nie na serwerze, więc podpowiedź nie
     mówi o współdzieleniu z zespołem i nie ma „Zapisz szkic”;
   - zamknięty czat, przy którym pola nie ma wcale. */

/** Limit z `MessageRequest.text` (`maxLength: 20000`) — dziesięć razy więcej
    niż w Centrum Wiadomości, bo to inny zasób. */
export const LIMIT_ZNAKOW = 20_000;

export function Edytor({
  tresc, wysyla, blad, czatAktywny, onZmiana, onWyslij,
  zalaczniki = [], dodajeZalacznik = false, bladZalacznika = "",
  onDodajZalacznik, onUsunZalacznik, etykietaWyslij = "Wyślij odpowiedź",
}: {
  tresc: string;
  wysyla: boolean;
  blad: string;
  /* Załączniki są opcjonalne, żeby sprawa bez obsługi plików nie dostała
     spinacza, który niczego nie wyśle. */
  zalaczniki?: ZalacznikSzkicu[];
  dodajeZalacznik?: boolean;
  bladZalacznika?: string;
  onDodajZalacznik?: (plik: File) => void;
  onUsunZalacznik?: (id: number) => void;
  /** `false` znaczy, że Allegro nie przyjmie już wiadomości w tej sprawie. */
  czatAktywny: boolean;
  onZmiana: (v: string) => void;
  onWyslij: () => void;
  /** Napis przycisku wysyłki; domyślny zostaje dla dyskusji. */
  etykietaWyslij?: string;
}) {
  return <EdytorOdpowiedzi szkic={tresc} wysyla={wysyla} blad={blad}
    onZmiana={onZmiana} onWyslij={onWyslij}
    zalaczniki={zalaczniki} dodajeZalacznik={dodajeZalacznik} bladZalacznika={bladZalacznika}
    onDodajZalacznik={onDodajZalacznik} onUsunZalacznik={onUsunZalacznik}
    etykietaWyslij={etykietaWyslij} limitZnakow={LIMIT_ZNAKOW}
    etykietaPola="Odpowiedź w sprawie"
    podpowiedz="Odpowiedź w tej sprawie — przeczyta ją kupujący, a bywa że i doradca Allegro"
    podpowiedzZwinieta="Odpowiedz w sprawie…"
    zamkniete={czatAktywny ? null
      : "Allegro zamknęło rozmowę w tej sprawie — nowej wiadomości nie przyjmie."} />;
}
