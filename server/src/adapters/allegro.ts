import { config } from "../config.js";
import { WERSJA } from "../wersja.js";
import { HttpAllegroAdapter } from "./allegro.http.js";
import { DevAllegroAdapter } from "./allegro.dev.js";

/* ── Allegro — kontrakt adaptera (zwroty klienckie, Etap 1) ──────────────────
   Pierwsza integracja HTTP wychodząca w tym serwerze. Ten plik trzyma WYŁĄCZNIE
   kontrakt i typy domenowe — spolszczone i wąskie: tylko pola, których serwis
   zwrotów faktycznie używa. Pełną odpowiedź API zwrot niesie obok w `surowe`
   (ląduje w `zwrot.surowe_json` — diagnoza dziś, paliwo korekty w Etapie 2).

   Implementacje, ten sam podział co Sfera (sfera.ts / sfera.sql.ts / sfera.dev.ts):
     • allegro.http.ts — prawdziwe API (fetch, Bearer z services/allegro-token.ts)
     • allegro.dev.ts  — fikcyjne zwroty zestrojone z seedem scenariuszy
       (S67–S69); zero sieci, działa w testach i demo                          */

export interface PaczkaZwrotu {
  /** Numer nadania przesyłki zwrotnej. */
  waybill: string | null;
  /**
   * Numer przewoźnika FIZYCZNIE doręczającego — bywa INNY niż `waybill`
   * (przekazanie paczki między przewoźnikami). Etykieta, którą magazyn widzi
   * u drzwi, nosi właśnie ten numer, dlatego skan pyta o oba.
   */
  transportingWaybill: string | null;
  przewoznik: string | null;
}

export interface PozycjaZwrotuAllegro {
  offerId: string | null;
  nazwa: string;
  /**
   * Sygnatura sprzedawcy z zamówienia (`offer.external.id`) — zwykle symbol
   * kartoteki nadany przez integrację sprzedażową. Zwrot jej NIE niesie;
   * serwis dokleja ją z `zamowienie()` po `offerId`.
   */
  externalId: string | null;
  ilosc: number;
  powod: string | null;
  powodOpis: string | null;
}

export interface ZwrotAllegro {
  id: string;
  orderId: string | null;
  /** referenceNumber — numer zwrotu, który widzi klient i panel sprzedawcy. */
  referencja: string | null;
  status: string | null;
  utworzono: string | null;
  kupujacyLogin: string | null;
  kupujacyEmail: string | null;
  pozycje: PozycjaZwrotuAllegro[];
  paczki: PaczkaZwrotu[];
  /** Pełna odpowiedź API — do `zwrot.surowe_json`, nigdy do logiki. */
  surowe: unknown;
}

export interface PozycjaZamowieniaAllegro {
  offerId: string | null;
  nazwa: string;
  externalId: string | null;
  ilosc: number;
}

export interface ZamowienieAllegro {
  id: string;
  kupujacyLogin: string | null;
  kupujacyEmail: string | null;
  pozycje: PozycjaZamowieniaAllegro[];
}

export interface AllegroAdapter {
  /**
   * Zwroty, których KTÓRAKOLWIEK paczka nosi ten numer — po `parcels.waybill`
   * ORAZ `parcels.transportingWaybill`. Zero wyników to poprawna odpowiedź
   * (etykieta spoza Allegro), nie błąd.
   */
  szukajZwrotowPoWaybill(waybill: string): Promise<ZwrotAllegro[]>;
  /** Szczegół zwrotu po id; `null` gdy nie istnieje. */
  zwrot(id: string): Promise<ZwrotAllegro | null>;
  /** Zamówienie (checkout-form) — źródło `externalId` pozycji; `null` gdy brak. */
  zamowienie(orderId: string): Promise<ZamowienieAllegro | null>;
}

/**
 * User-Agent do KAŻDEGO żądania (auth i API) — Allegro wymaga go wprost,
 * a brak prawidłowego nagłówka grozi zablokowaniem klucza. Wartość
 * wygenerowaną na developer.allegro.pl wkleja się w `ALLEGRO_USER_AGENT`;
 * fallback identyfikuje nas nazwą i wersją, nigdy domyślnym „node".
 */
export function allegroUserAgent(): string {
  return config.allegro.userAgent || `WERTIS/${WERSJA}`;
}

/**
 * Tryb faktycznie użyty: jawny `ALLEGRO_MODE` wygrywa, puste wynika
 * z `SGT_MODE` — ten sam wzorzec co `sferaMode`.
 */
export function allegroTryb(): "dev" | "http" {
  if (config.allegro.mode) return config.allegro.mode;
  return config.sgtMode === "mssql" ? "http" : "dev";
}

let _adapter: AllegroAdapter | null = null;

/**
 * Adapter wg konfiguracji — leniwie i raz: implementacja http trzyma stan
 * odświeżania tokena, a dev — nic, więc singleton niczego nie komplikuje.
 * Import dynamiczny nie jest tu potrzebny (oba moduły są lekkie), ale
 * wybór MUSI być leniwy, bo testy przestawiają config po imporcie modułów.
 */
export function allegroAdapter(): AllegroAdapter {
  if (_adapter) return _adapter;
  _adapter = allegroTryb() === "http" ? new HttpAllegroAdapter() : new DevAllegroAdapter();
  return _adapter;
}

/** Testy przestawiają tryb w locie — po zmianie configu adapter składa się od nowa. */
export function zresetujAdapterAllegro(): void {
  _adapter = null;
}
