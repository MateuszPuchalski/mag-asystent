# Wdrożenie WERTIS — Cloudflare Pages (frontend) + serwer API na LAN

## Co gdzie działa (ważne)

Aplikacja jest **full-stack** i dzieli się na dwie części o różnych wymaganiach:

| Część | Co to | Gdzie może działać |
|---|---|---|
| **Frontend** (`web/`) | statyczna PWA (React/Vite) | ✅ Cloudflare Pages (CDN, HTTPS, offline) |
| **Backend** (`server/`) | Fastify + SQLite + worker Sfery | ❌ NIE na Pages/Workers — patrz niżej |

**Dlaczego backend nie działa na Cloudflare Pages/Workers:**
- Fastify to serwer **Node.js**; Pages Functions/Workers używają runtime edge (V8),
  nie Node — Fastify tam nie wystartuje.
- `better-sqlite3` to **natywny addon** — nie działa na Workers.
- **Worker Sfery** to długodziałający proces z pętlą poll — edge jest request-scoped,
  brak procesów w tle.
- Produkcyjnie backend musi mieć dostęp do **MSSQL Subiekta w sieci LAN** i do
  **Sfery (COM/Windows)** — edge Cloudflare nie ma dostępu do sieci lokalnej magazynu.

To jest zgodne z architekturą ze specyfikacji (§3): serwer API stoi na LAN
magazynu, a worker Sfery na maszynie z Subiektem. **Cloudflare Pages hostuje
tylko kolektorową PWA**, która łączy się z tym serwerem po HTTPS.

```
Cloudflare Pages (PWA)  ──HTTPS──►  Serwer API na LAN (Fastify + SQLite + worker)
   web/dist                              │  read-only SELECT ──► MSSQL Subiekta
                                         │  worker Sfery (COM) ──► zapis SGT
```

## 1. Frontend na Cloudflare Pages

### Wariant A — bezpośredni upload (najprościej, zawsze działa)

```bash
# zbuduj z adresem API wskazującym na Twój serwer
VITE_API_BASE=https://mag-api.twojafirma.pl npm run build:web
npx wrangler pages deploy web/dist --project-name wertis-kolektor
```

(`npm run deploy:pages` robi build + deploy; pamiętaj o `VITE_API_BASE`.)

### Wariant B — build z repozytorium (Git integration)

W panelu Cloudflare → Pages → *Create project* → połącz repo i ustaw:

| Ustawienie | Wartość |
|---|---|
| **Root directory** | `web` |
| **Build command** | `npm install && npm run build` |
| **Build output directory** | `dist` |
| **Environment variable** | `VITE_API_BASE = https://mag-api.twojafirma.pl` |

> `VITE_API_BASE` jest wstrzykiwane **przy budowaniu** (nie w runtime), więc po
> jego zmianie trzeba przebudować deploy. Puste = ten sam origin (nie zadziała na
> Pages, bo tam nie ma backendu — ustaw absolutny URL API).

Pliki pomocnicze są już w repo: `wrangler.toml` (`pages_build_output_dir`),
`web/public/_redirects` (fallback SPA), `web/.env.example`.

## 2. Backend API na LAN

Serwer + worker uruchamiane na maszynie w sieci magazynu (Linux lub Windows):

```bash
npm ci
npm run seed          # tylko przy pierwszym starcie (SQLite z mag.xlsx)
npm run build:server
npm start                       # API (Fastify)
npm -w server run start:worker  # worker Sfery (osobny proces)
```

Wymagania produkcyjne, żeby PWA z Pages (HTTPS) mogła się połączyć:
- API musi być wystawione po **HTTPS** (Pages jest HTTPS — przeglądarka zablokuje
  mixed content do `http://`). Użyj reverse-proxy (Caddy/nginx/Cloudflare Tunnel)
  z certyfikatem.
- **CORS**: serwer ma już `cors({ origin: true })` (odbija origin) — dozwoli
  wywołania z domeny Pages. W razie potrzeby zawęź do konkretnego origin.
- Przełączenie na prawdziwy Subiekt: `SGT_MODE=mssql` + implementacja adapterów
  `subiekt.mssql.ts` / `sfera.com.ts` (worker na Windows z Sferą).

### Alternatywa: Cloudflare Tunnel

Jeśli serwer LAN nie ma publicznego IP, wystaw go bez otwierania portów przez
**Cloudflare Tunnel** (`cloudflared`) pod stałą subdomeną (np. `mag-api...`),
i ten adres podaj w `VITE_API_BASE`. Tunel daje HTTPS i trzyma API w LAN.

## 3. Pełny cloud demo (opcjonalnie)

Jeśli chcesz, żeby **całość** działała na Cloudflare bez serwera LAN (tylko jako
pokaz na danych z `mag.xlsx`, bez realnego Subiekta), backend trzeba przepisać na
Cloudflare Workers + D1 (SQLite Cloudflare) + Cron Triggers/Durable Objects
zamiast workera-procesu. To osobny nakład pracy i i tak nie połączy się z Subiektem
GT/Sferą (edge nie ma dostępu do LAN/COM) — sensowne tylko jako demo. Do ustalenia.
