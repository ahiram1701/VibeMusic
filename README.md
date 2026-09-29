# VibeMusic

**Vibecoding para música.** Describe la canción en lenguaje natural; un agente productor (LLM configurable)
genera audio con proveedores locales o en la nube, lo coloca en un timeline multipista, y puedes seguir
refinándolo por conversación con historial de versiones.

## Instalar (Windows)

1. Descarga `VibeMusic-Setup-X.Y.Z.exe` de la página **Releases** del repositorio.
2. Ábrelo. Como el instalador no está firmado, Windows SmartScreen avisará: pulsa
   **Más información → Ejecutar de todas formas**.
3. Se instala para tu usuario (sin permisos de administrador) y crea un acceso directo.

Para generar con IA puedes usar el motor **Demo** (sin instalar nada), **Replicate** (token en
Ajustes) o el motor **Local**, que se instala desde ⚙ Ajustes y necesita Python 3.10–3.13.

## Desarrollo

```bash
npm install
npm run dev        # app en modo desarrollo
npm test           # tests (Vitest)
npm run lint       # ESLint + Prettier
npm run typecheck
npm run dist       # instalador local en release/
```

Sidecar local (opcional, requiere GPU para los modelos):

```bash
cd sidecar
python -m venv .venv && .venv/Scripts/activate
pip install -e ".[dev]"          # añade ,models para MusicGen/Demucs
python server.py                 # http://127.0.0.1:8765/health
```

## Arquitectura

| Capa              | Ruta            | Rol                                                                      |
| ----------------- | --------------- | ------------------------------------------------------------------------ |
| Modelo compartido | `src/shared/`   | `Project`, `Track`, `Region`, `Clip`, `GenerationSpec`, contrato IPC     |
| Main (Node)       | `src/main/`     | Persistencia y versiones, agente productor, proveedores de audio, export |
| Renderer (React)  | `src/renderer/` | Chat, timeline, mezclador, motor Web Audio                               |
| Sidecar (Python)  | `sidecar/`      | MusicGen / Stable Audio Open / Demucs vía FastAPI                        |

Un proyecto es una carpeta: `project.json`, `versions/<n>.json` (snapshots) y `clips/*.wav`.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): lint, typecheck, tests y build en Windows y Linux; e2e con
  Playwright, y en Windows además se empaqueta la app y se prueba el ejecutable empaquetado
  (`e2e/packaged.spec.ts`); ruff + pytest del sidecar.
- **CD** (`.github/workflows/release.yml`): al subir un tag `vX.Y.Z` comprueba que coincide con
  `package.json`, construye el instalador, lo prueba y lo sube a un **borrador** de GitHub Release,
  que se publica a mano. La app instalada se auto-actualiza con `electron-updater` (solo si el
  repositorio es público; si es privado, cada versión se instala a mano).

```bash
npm version minor
git push --follow-tags
```

## Licencias

Código bajo licencia MIT. Componentes y modelos de terceros (LAME para MP3, MusicGen, servicios
en la nube) tienen sus propias licencias: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
En particular, los pesos de **MusicGen son CC-BY-NC 4.0 (no comercial)**.
