# Avisos de terceros

VibeMusic se distribuye bajo licencia MIT. Incluye o usa los siguientes componentes de terceros,
cada uno con su propia licencia.

## Incluidos en la aplicación

### LAME (vía `@breezystack/lamejs`) — LGPL-3.0

Codificador MP3 usado al exportar. Se distribuye **sin modificar y como un archivo separado**
(`out/renderer/assets/mp3.worker-*.js`), cargado en un Web Worker, de modo que puede
sustituirse por otra versión compatible. Código fuente: https://github.com/BreezyStack/lamejs
y https://lame.sourceforge.io. Texto de la licencia: https://www.gnu.org/licenses/lgpl-3.0.html

## Modelos de IA (no incluidos: se descargan al usarlos)

### MusicGen (Meta) — pesos bajo CC-BY-NC 4.0

Lo usan el motor **Local** (descargado desde Hugging Face la primera vez) y **Replicate**.
Los pesos del modelo se publican bajo Creative Commons Atribución-NoComercial 4.0
(https://creativecommons.org/licenses/by-nc/4.0/). **Revisa esta licencia y los términos de
Replicate antes de usar comercialmente la música generada.**

## Servicios en la nube (opcionales)

Replicate, Anthropic, Groq, OpenAI y demás proveedores configurables se rigen por sus propios
términos de uso; la app solo actúa como cliente con la clave que proporciona el usuario.
