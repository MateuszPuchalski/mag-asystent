import { subiekt } from "../context.js";
import { config } from "../config.js";
import type { ProductRow } from "../types.js";

/** Wzorzec EAN — kod towaru, którego NIE wolno zapisać jako lokalizacji. */
const EAN_RE = /^\d{8}$|^\d{12,14}$/;

/**
 * Walidacja kodu lokalizacji (spec §4, §12 + analiza „widmowe lokalizacje").
 * Reguły bazowe działają zawsze (chronią przed mis-skanem etykiety towaru):
 *  - brak pustego / spacji (spacja = separator w polu tw_Lokalizacja),
 *  - kod nie może być EAN-em (skan towaru zamiast etykiety regału),
 *  - kod musi zawierać literę (lokalizacje mają litery A–J/PALETA; EAN nie).
 * Dodatkowo — gdy `locStrict` — twarde dopasowanie do `locFormat`.
 * Zwraca komunikat błędu lub `null` gdy kod jest poprawny.
 */
export function validateLocationCode(raw: string): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  if (!code) return "Pusty kod lokalizacji";
  if (/\s/.test(code)) return "Kod lokalizacji nie może zawierać spacji";
  if (EAN_RE.test(code)) return "To wygląda jak kod towaru (EAN), nie etykieta lokalizacji";
  if (!/[A-Z]/.test(code)) return "Kod lokalizacji musi zawierać literę — to nie wygląda na miejsce";
  if (config.locStrict) {
    try {
      if (!new RegExp(config.locFormat).test(code))
        return "Kod nie pasuje do formatu lokalizacji (np. E08-03-01)";
    } catch {
      /* zły regex w konfiguracji — pomiń twardą walidację formatu */
    }
  }
  return null;
}

/** Czy kod pasuje do skonfigurowanego wzorca (do podpowiedzi po stronie klienta). */
export function matchesFormat(code: string): boolean {
  try {
    return new RegExp(config.locFormat).test(code.trim().toUpperCase());
  } catch {
    return true;
  }
}

/** Wykaz istniejących kodów lokalizacji (słownik) — do ostrzeżeń o kodzie spoza wykazu. */
export function listLocations(): string[] {
  return subiekt.listLocations();
}

/** Towary fizycznie przypisane do danej lokalizacji (reverse lookup). */
export function getProductsByLocation(code: string): ProductRow[] {
  return subiekt.getProductsByLocation(code.trim().toUpperCase());
}
