import React from "react";
import { ExternalLink } from "lucide-react";

/**
 * Odnośnik na zewnątrz — jedna definicja na cały ekran zwrotów.
 *
 * Bez adresu zostaje sam tekst: link donikąd kosztuje kliknięcie i zaufanie
 * do ekranu, więc jest gorszy od jego braku. Stoi w osobnym pliku od 0.167.0,
 * bo używają go dwie kolumny — produkty w środku i dowody po prawej — a druga
 * kopia rozjechałaby się przy pierwszej poprawce jednej z nich.
 */
export const Link = ({ href, children }: { href: string | null; children: React.ReactNode }) =>
  href
    ? <a href={href} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
        {children}<ExternalLink size={13} /></a>
    : <span>{children}</span>;
