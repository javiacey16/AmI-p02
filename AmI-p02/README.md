# P2 · El mando gestual del salón (plantilla)

1. El vídeo de la «televisión» es `video.mp4` (para usar otro, sustitúyelo o cambia el `src` del `<video id="player">` en `index.html`).
2. Abre la carpeta en VS Code y lanza `index.html` con Live Server (no funciona con `file://`).
3. Pulsa «Activar cámara»: verás los puntos de las manos y el panel de resultados.

Lo que tenéis que programar está en `index.js`, sección 6, `recognizeGestures()`. Las acciones sobre el reproductor ya están hechas (sección 7): `seek(segundos)`, `changeVolume(delta)`, `closePlayer()`, `togglePause()` y `toggleMute()`. Cada acción queda en el registro de la página, que se puede descargar en CSV para la evaluación.

- Usad un servidor que admita peticiones parciales (Live Server o `npx serve`). Con `python3 -m http.server` el vídeo se reproduce, pero no se puede saltar a otro instante.
- Para comparar GPU y CPU, añadid `?delegate=cpu` a la URL.
- MediaPipe Tasks Vision está fijado en la versión 1.2.2: el `.mjs` y la carpeta `wasm` deben ser de la misma versión.

## Créditos del vídeo

`video.mp4` es *Big Buck Bunny* (2008), © Blender Foundation, www.bigbuckbunny.org, con licencia
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). Versión de 320×180
descargada de https://download.blender.org/peach/bigbuckbunny_movies/.
