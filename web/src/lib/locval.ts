import type { LocationsInfo } from "./api";

const EAN_RE = /^\d{8}$|^\d{12,14}$/;

/** Normalizacja skanu lokalizacji: uppercase, obcięcie prefiksu `LOC:` z QR. */
export function normalizeLoc(raw: string): string {
  return raw.trim().toUpperCase().replace(/^LOC:/, "");
}

/** Walidacja kodu lokalizacji po stronie klienta (lustro serwera — services/locations.ts). */
export function validateLoc(code: string, info?: LocationsInfo): string | null {
  if (!code) return "Pusty kod lokalizacji";
  if (/\s/.test(code)) return "Kod lokalizacji nie może zawierać spacji";
  if (EAN_RE.test(code)) return "To wygląda jak kod towaru (EAN), nie etykieta lokalizacji";
  if (!/[A-Z]/.test(code)) return "Kod lokalizacji musi zawierać literę — to nie wygląda na miejsce";
  if (info?.strict && info.format) {
    try {
      if (!new RegExp(info.format).test(code)) return "Kod nie pasuje do formatu lokalizacji (np. E08-03-01)";
    } catch {
      /* zły regex — pomiń */
    }
  }
  return null;
}

/** Czy kod jest w słowniku istniejących lokalizacji. */
export function isKnownLoc(code: string, info?: LocationsInfo): boolean {
  return !!info?.codes?.includes(code);
}
