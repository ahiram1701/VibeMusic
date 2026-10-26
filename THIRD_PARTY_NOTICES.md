# Avisos de terceros

VibeMusic se distribuye bajo licencia MIT. Incluye o usa los siguientes componentes de terceros,
cada uno con su propia licencia.

## Incluidos en la aplicación

### LAME (vía `@breezystack/lamejs`) — LGPL-3.0

Codificador MP3 usado al exportar. Se distribuye **sin modificar y como un archivo separado**
(`out/renderer/assets/mp3.worker-*.js`), cargado en un Web Worker, de modo que puede
sustituirse por otra versión compatible. Código fuente: https://github.com/BreezyStack/lamejs
y https://lame.sourceforge.io. Texto de la licencia: https://www.gnu.org/licenses/lgpl-3.0.html

### Lucide (`lucide-react`) — licencia ISC

Iconos de la interfaz. https://lucide.dev — © Lucide Contributors.

### `@gradio/client` (Hugging Face) — licencia ISC

Cliente de la API de Gradio con el que se habla con el Space de ACE-Step.
https://github.com/gradio-app/gradio

## Descargados al instalar funciones opcionales (no incluidos en el instalador)

### OpenUtau (motor del cantante local) — MIT

Se compila desde el fork [boxboy523/OpenUtau-Headless](https://github.com/boxboy523/OpenUtau-Headless)
(MIT, © 2014 StAkira y colaboradores de OpenUtau) con un parche de
[Jibaru/vocaloid-cli](https://github.com/Jibaru/vocaloid-cli) (MIT, © 2026 Ignacio Rueda). Ver
`singer-engine/`.

### Hoshino Hanami ~AI❤dol~ (voicebank DiffSinger) — Team L❤VE Voicebank License

La voz del cantante local, de **Lotte V** (https://lottev.moe). Se descarga desde su enlace
original y no se redistribuye. Permite el uso comercial y no comercial **dando crédito a Lotte V**;
no permite volver a subir ni vender los archivos, ni crear voces derivadas por medios ajenos al
software de síntesis (por eso "Mi voz" no se aplica a ella). Condiciones:
https://github.com/lottev1991/LotteV-Voicebank-Update-Repo/blob/main/ToU_ES.md

### Applio (RVC, "Mi voz") — MIT

Conversión de voz con los modelos que entrena el propio usuario. Se instala desde la etiqueta
3.6.6 de https://github.com/IAHispano/Applio en un entorno de Python propio, con sus modelos base
(ContentVec, RMVPE, FCPE).

## Modelos de IA (no incluidos: se descargan al usarlos)

### MusicGen (Meta) — pesos bajo CC-BY-NC 4.0

Lo usan el motor **Local** (descargado desde Hugging Face la primera vez) y **Replicate**.
Los pesos del modelo se publican bajo Creative Commons Atribución-NoComercial 4.0
(https://creativecommons.org/licenses/by-nc/4.0/). **Revisa esta licencia y los términos de
Replicate antes de usar comercialmente la música generada.**

### ACE-Step 1.5 — licencia Apache-2.0 (Space de Hugging Face: MIT)

Canciones con voz que cantan la letra. Se usa a través del Space público
`ACE-Step/Ace-Step-v1.5` de Hugging Face, con la GPU gratuita de HF (ZeroGPU, cuota diaria por
usuario). https://github.com/ace-step/ACE-Step-1.5

### Demucs (Meta) — código y modelo `htdemucs` bajo licencia MIT

Separación de pistas (voz, batería, bajo, otros) en el motor local. Se instala en el entorno del
motor y el modelo se descarga la primera vez que se usa. https://github.com/adefossez/demucs

## Servicios en la nube (opcionales)

Hugging Face, Replicate, Anthropic, Groq, OpenAI y demás proveedores configurables se rigen por sus propios
términos de uso; la app solo actúa como cliente con la clave que proporciona el usuario.
