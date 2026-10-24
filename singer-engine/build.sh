#!/usr/bin/env bash
# Compila el motor del cantante local (OpenUtau sin interfaz) para una plataforma.
# Uso: singer-engine/build.sh <rid> <carpeta-de-salida>
#   rid: win-x64 | linux-x64 | osx-arm64 | osx-x64
set -euo pipefail

UPSTREAM="https://github.com/boxboy523/OpenUtau-Headless.git"
# Fijado: el parche está escrito contra este commit.
COMMIT="db6ddc728463197495ef39ef95886ccdf9970ddf"

RID="${1:?plataforma (rid), p. ej. win-x64}"
OUT="${2:?carpeta de salida}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$UPSTREAM" "$WORK/src"
git -C "$WORK/src" checkout --quiet "$COMMIT"
git -C "$WORK/src" apply --ignore-whitespace "$HERE/openutau-headless.patch"

export DOTNET_CLI_TELEMETRY_OPTOUT=1
mkdir -p "$OUT"
OUT_ABS="$(cd "$OUT" && pwd -P)"
cd "$WORK/src"
dotnet publish OpenUtau.Cli -c Release -r "$RID" --self-contained true -o "$OUT_ABS"
test -e "$OUT_ABS/OpenUtau.Cli" || test -e "$OUT_ABS/OpenUtau.Cli.exe"
echo "Motor compilado en $OUT_ABS para $RID"
