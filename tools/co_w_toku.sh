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
echo "Otwarte PR-y sprawdź narzędziami GitHuba — ten skrypt ich nie widzi."
