#!/bin/sh
# Co budują inne gałęzie (0.161.1).
#
# Uruchamiane hakiem `SessionStart` z `.claude/settings.json` oraz ręcznie,
# przed zaczęciem wydania. Powód stoi w `CLAUDE.md` §„Zanim zaczniesz":
# nad tym repo pracuje kilka sesji naraz. Raz zbudowały tę samą funkcję
# równolegle (statusy rozmowy, 0.157.0 i 0.158.0) i jedna implementacja poszła
# do kosza; raz nazwały tym samym numerem dwa różne wydania (0.159.0).
#
# NIGDY nie kończy się błędem. To jest sprawdzenie informacyjne, a start sesji
# nie ma prawa paść przez brak sieci, świeży klon bez `origin` ani przez to,
# że ktoś odpalił skrypt spoza repo.

OKNO=${OKNO_GODZIN:-48}

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "Gałęzie w toku: nie jestem w repozytorium gita."
  exit 0
}

# Cicho i bez przerywania: brak sieci znaczy „pokaż, co wiesz z lokalnych
# refów", a nie „nie mów nic".
git fetch --prune -q origin 2>/dev/null || true

teraz=$(date +%s)
prog=$((teraz - OKNO * 3600))

# Merge'e pomijamy w wypisie: „Scalenie main do gałęzi X" nie mówi, co ktoś
# buduje, a zajmuje ten sam wiersz co commit, który mówi.
wynik=$(git for-each-ref --sort=-committerdate \
          --format='%(refname:short) %(committerdate:unix)' refs/remotes/origin 2>/dev/null |
  while read -r galaz kiedy; do
    [ "$galaz" = "origin/main" ] && continue
    [ "${kiedy:-0}" -lt "$prog" ] && continue
    ile=$(git rev-list --count "origin/main..$galaz" 2>/dev/null || echo 0)
    [ "${ile:-0}" -gt 0 ] || continue
    echo "── ${galaz#origin/}  (+$ile, $(git log -1 --format=%cr "$galaz"))"
    git log --oneline --no-merges -3 "origin/main..$galaz" 2>/dev/null | sed 's/^/     /'
  done)

echo "Gałęzie w toku (ostatnie ${OKNO} h):"
if [ -n "$wynik" ]; then
  echo "$wynik"
else
  # Cisza jest nieodróżnialna od awarii skryptu, więc pustka mówi o sobie.
  echo "   żadna inna gałąź nie ma commitów spoza main"
fi

# Wersje obok siebie, bo kolizja dwóch sesji objawia się najpierw wyścigiem
# numerów wydania. Nieznane mówi „?" — puste miejsce wygląda jak zero.
wersja() { sed -n 's/.*"version": "\([^"]*\)".*/\1/p' | head -1; }
zdalna=$(git show origin/main:package.json 2>/dev/null | wersja)
lokalna=$([ -f package.json ] && wersja < package.json)
echo "Wersja: main ${zdalna:-?}, lokalnie ${lokalna:-?}"

# ── Świeżość zależności (0.193.1) ────────────────────────────────────────────
# `node_modules` starsze niż `package.json` UDAJE ZEPSUTE REPO. Kosztowało to
# już cały przebieg: `npm test` pokazał 290 porażek na czystym `main`, bo
# pakiet dołożony w międzyczasie nie był zainstalowany. Fałszywa awaria jest
# droższa od prawdziwej — przy prawdziwej wiadomo przynajmniej, czego szukać.
#
# Sprawdzamy ISTNIENIE katalogu pakietu, nie zgodność wersji. Brak jest
# jednoznaczny i kosztuje jedno `stat` na zależność; rozjazd wersji łapie
# i tak `npm ci` przy instalacji, więc dublowanie go tutaj nic nie wnosi.
echo
if ! command -v node >/dev/null 2>&1; then
  echo "Zależności: nie wiem — brak node w PATH."
elif [ ! -d node_modules ]; then
  echo "Zależności: BRAK node_modules — uruchom 'npm ci'."
else
  # Node, a nie `sed` po JSON-ie: lista zależności to struktura, a nie tekst,
  # i w tym repo node jest z definicji. Skrypt milczy przy każdym błędzie —
  # start sesji nie ma prawa paść przez sprawdzenie informacyjne.
  brak=$(node -e '
    const fs = require("fs"), p = require("path");
    const zPliku = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
    const korzen = zPliku("package.json");
    if (!korzen) process.exit(0);
    const brak = new Set();
    for (const m of ["."].concat(korzen.workspaces || [])) {
      const pj = zPliku(p.join(m, "package.json"));
      if (!pj) continue;
      for (const n of Object.keys({ ...pj.dependencies, ...pj.devDependencies })) {
        // Pakiet ze workspace npm dowiązuje do korzenia, więc obie ścieżki liczą sie tak samo.
        if (fs.existsSync(p.join("node_modules", n))) continue;
        if (fs.existsSync(p.join(m, "node_modules", n))) continue;
        brak.add(n);
      }
    }
    const lista = [...brak];
    if (lista.length) console.log(lista.slice(0, 5).join(" ") + (lista.length > 5 ? " (+" + (lista.length - 5) + ")" : ""));
  ' 2>/dev/null)
  if [ -n "$brak" ]; then
    echo "UWAGA: zależności nieaktualne — brakuje: $brak"
    echo "       uruchom 'npm ci', inaczej testy pokażą awarie, których nie ma"
  fi
fi

# ── Otwarte PR-y (0.174.1) ───────────────────────────────────────────────────
# Gałąź z commitami spoza `main` mówi „ktoś tu pracuje". Otwarty PR mówi więcej:
# ktoś to ZAMYKA i zaraz zajmie numer wydania. Do 0.174.0 skrypt kończył się
# zdaniem „sprawdź narzędziami GitHuba" — i właśnie dlatego nikt nie sprawdzał.
# Numer zderzył się z cudzą gałęzią cztery razy w jednym dniu (0.166.0, 0.168.0,
# 0.171.0, 0.173.0), za każdym razem kosztując przenumerowanie kilkunastu plików.
#
# `gh` jest OPCJONALNE. Bez niego skrypt mówi, czego nie wie, i kończy się
# zerem — tak samo jak przy braku sieci. Sprawdzenie informacyjne nie ma prawa
# położyć startu sesji ani zależeć od cudzego narzędzia.
ghc() {
  # Limit czasu, bo `gh` przy zerwanej sieci albo wygasłym tokenie potrafi
  # wisieć — a to jest hak SessionStart, nie zadanie w tle. `timeout` bywa
  # nieobecny (macOS bez coreutils), więc jego brak nie blokuje wywołania.
  if command -v timeout >/dev/null 2>&1; then timeout 10 gh "$@"; else gh "$@"; fi
}

echo
if ! command -v gh >/dev/null 2>&1; then
  echo "Otwarte PR-y: nie wiem — brak gh w PATH (cli.github.com)."
elif ! pry=$(ghc pr list --state open --limit 30 \
       --json number,title,headRefName,isDraft \
       --jq '.[] | "\(.number)\t\(.title)\t\(.headRefName)\t\(if .isDraft then "szkic" else "gotowy" end)"' \
       2>/dev/null); then
  # Nierozróżnialne bez dopytywania: brak sieci, wygasły token, repo bez
  # uprawnień. Wszystkie trzy naprawia to samo zdanie.
  echo "Otwarte PR-y: nie wiem — gh nie odpowiedział (sieć albo gh auth login)."
elif [ -z "$pry" ]; then
  echo "Otwarte PR-y: żadnego."
else
  echo "Otwarte PR-y:"
  echo "$pry" | while IFS="$(printf '\t')" read -r nr tytul galaz stan; do
    echo "── #$nr  $tytul"
    echo "     ${galaz}  ·  ${stan}"
  done

  # Numer wydania z TYTUŁU PR-a: konwencja repo mówi „tytuł z numerem wersji",
  # więc to jedyne miejsce, gdzie numer widać bez pobierania gałęzi. Jednym
  # przebiegiem po całej liście, a nie pętlą — pętla w potoku chodzi
  # w podpowłoce i zmienna wróciłaby stąd pusta, po cichu.
  numery() {
    cut -f2 | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | sort -u | tr '\n' ' '
  }
  zajete=$(echo "$pry" | numery)
  [ -n "$zajete" ] && echo "Numery zajęte przez otwarte PR-y: ${zajete% }"

  # Do ostrzeżenia liczą się WYŁĄCZNIE cudze gałęzie. Własny PR nazywa ten sam
  # numer co lokalne `package.json` z definicji — ostrzeganie przed samym sobą
  # nauczyłoby ignorować to zdanie, a ma być głośne.
  tu=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  obce=$(echo "$pry" | awk -F'\t' -v tu="$tu" '$3 != tu' | numery)
  # Najgłośniejszy sygnał kolizji: numer, który właśnie wpisałeś, nazywa już
  # cudze wydanie. Złapany tutaj kosztuje jeden plik, a nie kilkanaście.
  # Równość z `main` to nie kolizja, tylko gałąź jeszcze przed podbiciem.
  for n in $obce; do
    if [ "$n" = "${lokalna:-}" ] && [ "$n" != "${zdalna:-}" ]; then
      echo "UWAGA: lokalne $n nazywa już cudzy PR — wybierz inny numer."
    fi
  done
fi
