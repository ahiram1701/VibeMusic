# VibeMusic

**Vibecoding para música.** Describe la canción en lenguaje natural; un agente productor (LLM configurable)
genera audio con proveedores locales o en la nube, lo coloca en un timeline multipista, y puedes seguir
refinándolo por conversación con historial de versiones.

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

- **CI** (`.github/workflows/ci.yml`): lint, typecheck, tests y build en Windows y Linux, y ruff + pytest del sidecar.
- **CD** (`.github/workflows/release.yml`): al publicar un tag `vX.Y.Z` construye el instalador y crea un borrador de GitHub Release; la app se auto-actualiza con `electron-updater`.

```bash
npm version minor
git push --follow-tags
```

## Licencias

Código bajo licencia MIT. Componentes y modelos de terceros (LAME para MP3, MusicGen, servicios
en la nube) tienen sus propias licencias: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
En particular, los pesos de **MusicGen son CC-BY-NC 4.0 (no comercial)**.
