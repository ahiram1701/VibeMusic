# Motor del cantante local (OpenUtau sin interfaz)

El cantante local de VibeMusic canta con [OpenUtau](https://github.com/openutau/OpenUtau) y
DiffSinger en el equipo del usuario, sin ventana. Este directorio contiene cómo se compila ese
motor. La app no lo incluye en el instalador: lo descarga la primera vez desde la release
`singer-engine-v1` de este repositorio.

- **Código:** el fork [boxboy523/OpenUtau-Headless](https://github.com/boxboy523/OpenUtau-Headless)
  (MIT), que añade `OpenUtau.Cli` (`render --project canción.ustx --output voz.wav`). Está fijado
  a un commit en `build.sh`.
- **Parche:** `openutau-headless.patch` viene de
  [Jibaru/vocaloid-cli](https://github.com/Jibaru/vocaloid-cli/tree/main/engine) (MIT, © 2026
  Ignacio Rueda). Arregla el prefijo de idioma de los fonemizadores DiffSinger, hace que el motor
  falle enseguida (código 6) cuando no sabe pronunciar una sílaba y permite activar el registro
  con `OPENUTAU_CLI_LOG`.

## Publicar una versión del motor

El workflow `.github/workflows/singer-engine.yml` se ejecuta al subir un tag `singer-engine-v*`.
Compila el motor para Windows, Linux y macOS y lo sube como **prerelease**. Es prerelease para
que la actualización automática de la app no la tome por una versión de VibeMusic.

```bash
git tag singer-engine-v1
git push origin singer-engine-v1
```

Si cambias el tag, actualiza `ENGINE_TAG` en `src/main/singer/engine.ts`.

## Compilar en local

Necesita el SDK de .NET 8 o posterior:

```bash
singer-engine/build.sh win-x64 out/singer-engine
```

Para probar la app con una compilación local sin publicarla, comprime la carpeta en un `.zip` y
define `VIBE_SINGER_ENGINE_ZIP` con su ruta. Con `VIBE_SINGER_VOICE_ZIP` puedes además usar un
`.zip` de la voz ya descargado.
