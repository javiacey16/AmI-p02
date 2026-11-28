# P2 · El mando gestual del salón

Mando a distancia para la televisión del salón controlado con gestos de las manos. La cámara web
detecta las manos con [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
y la página controla un vídeo: avanzar y retroceder, cerrarlo, cambiar el volumen, pausar y
silenciar. El reto es el **problema de Midas**: responder a los gestos intencionados y no a los
movimientos normales de una persona sentada en el sofá (hablar gesticulando, beber, coger el móvil).

**Pruébalo en línea:** https://javiacey16.github.io/AmI-p02/AmI-p02/

Todo se procesa en el navegador. Solo se descargan el modelo y las bibliotecas de MediaPipe, y la
imagen de la cámara no sale del equipo.

## Cómo ejecutarlo

1. Sirve esta carpeta con un servidor local que admita peticiones parciales, por ejemplo la
   extensión Live Server de VS Code o `npx serve`. Con `file://` no funciona la cámara, y con
   `python -m http.server` el vídeo se reproduce pero no se puede saltar a otro instante.
2. Abre `index.html` y pulsa «Activar cámara».
3. Siéntate a 1,5 m de la cámara con la mano derecha a la vista.

Opciones:

- `?delegate=cpu` en la URL fuerza la CPU en lugar de la GPU.
- MediaPipe Tasks Vision está fijado en la versión 1.2.2. El `.mjs` y la carpeta `wasm` deben ser
  de la misma versión.

## Gestos

Los gestos de una mano se hacen con la **mano derecha**. Las medidas son relativas al tamaño de la
mano (distancia de la muñeca al nudillo del corazón), así que los umbrales valen cerca y lejos de
la cámara.

| Acción | Gesto | Condiciones principales |
| --- | --- | --- |
| Activar el mando | Mano derecha abierta, palma hacia la cámara y dedos hacia arriba | Quieta 1 s. El mando acepta órdenes durante 5 s, y cada orden reinicia ese plazo |
| Avanzar / retroceder 10 s | Barrido de la mano abierta hacia la derecha / izquierda | ≥ 1,5 tamaños de mano en 0,5 s, al menos el doble que en vertical |
| Cerrar el vídeo | Puño derecho | Dedo largo más abierto con cociente < 0,9 y punta a < 0,5 tamaños de mano del nudillo |
| Subir / bajar el volumen | Índice derecho señalando y palma izquierda hacia la cámara; subir o bajar la derecha | ≥ 0,8 tamaños de mano en 0,5 s. Cada gesto cambia el volumen en 0,1 |
| Pausar / reanudar | Círculo con el índice derecho | Giro ≥ 300°, 7 de 8 direcciones, tamaño ≥ 0,8 y redondez ≥ 0,6 |
| Silenciar / quitar el silencio | Índice derecho levantado con el dorso hacia la cámara | Palma < −0,4, dedos hacia arriba y mano quieta |

Pausar y silenciar se eligieron con una mini elicitación con tres personas (ver
[`../elicitacion/`](../elicitacion/)).

## Defensas contra el problema de Midas

El interruptor «Defensas» activa estas protecciones. La aplicación **se abre con las defensas
desactivadas**, que es la versión de referencia de la evaluación.

| Gesto | Defensas |
| --- | --- |
| Activación | Histéresis (4→3 dedos, palma 0,5→0,3), tolerancia a pérdidas de 0,2 s, barra de progreso |
| Avanzar / retroceder | Postura mantenida 0,3 s antes del barrido; espera de 0,4 s en la misma dirección y 1,2 s en la contraria |
| Cerrar | Puño mantenido 0,4 s, histéresis, tolerancia de 0,15 s, barra de progreso |
| Volumen | Posturas mantenidas 0,3 s; espera de 0,3 s en la misma dirección y 1,2 s en la contraria |
| Pausar / reanudar | Tolerancia de 0,2 s sin la postura; se ignoran los círculos durante 1 s tras alternar; progreso desde 120° |
| Silenciar | Postura mantenida 0,5 s, histéresis en la palma (−0,4→−0,2), tolerancia de 0,15 s, barra de progreso |

El interruptor «Gesto de activación» permite también probar el mando siempre activo.

## Interfaz

- **Controles**: activar la cámara, encender o apagar el gesto de activación y las defensas, y
  reabrir el vídeo tras cerrarlo.
- **Escenario**: la cámara en espejo con los puntos de las manos, y la televisión.
- **Estado del mando**: en reposo, activado (con los segundos que le quedan), siempre activo o a
  punto de ejecutar una orden (con su progreso).
- **Indicadores**: número de manos, cada mano detectada y FPS.
- **Medidas para calibrar**: las medidas de cada mano (dedos, cocientes, palma, dedos hacia arriba,
  movimiento) y, en la derecha, las del círculo. Con ellas se fijaron los umbrales.
- **Registro de acciones**: cada acción y cada cambio de configuración con su instante. Se puede
  descargar en CSV para la evaluación y borrar.

## Estructura del código

| Fichero | Contenido |
| --- | --- |
| `index.html` | Página: controles, escenario, estado, indicadores, medidas y registro |
| `style.css` | Estilos de la interfaz |
| `index.js` | Creación de la tarea de MediaPipe, bucle por fotograma, reconocimiento de gestos y defensas (sección 6, con los umbrales en `ACTIVATION`, `FIST`, `SWIPE`, `VOLUME`, `CIRCLE` y `MUTE`) y acciones sobre el reproductor (sección 7) |
| `gestures.js` | Funciones reutilizables: tamaño de la mano, dedos extendidos, orientación de la palma, seguimiento del movimiento, medida del círculo, gestos mantenidos (`HoldGesture`) y espera según la dirección (`StrokeGate`) |
| `video.mp4` | Vídeo de la «televisión» |

## Resultados

La evaluación se hizo con tres personas a 1,5 m, con y sin defensas. Con defensas, los aciertos
pasan del 66 % al 81 % y las activaciones involuntarias bajan de 142 a 67. A cambio, cerrar y
silenciar pasan de una reacción inmediata a medio segundo. El detalle está en la
[memoria](../memoria/P2_Memoria.pdf).

## Créditos del vídeo

`video.mp4` es *Big Buck Bunny* (2008), © Blender Foundation, www.bigbuckbunny.org, con licencia
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). Versión de 320×180
descargada de https://download.blender.org/peach/bigbuckbunny_movies/.
