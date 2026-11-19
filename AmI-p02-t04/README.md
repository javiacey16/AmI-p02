# Tutorial 4 · Manos con MediaPipe Hand Landmarker y el problema de Midas

Una página web que usa la cámara para detectar las manos con
[MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
y enciende o apaga una «lámpara del salón» cuando juntas el pulgar y el índice (una **pinza**).

**Pruébalo en línea:** https://javiacey16.github.io/AmI-p02/AmI-p02-t04/
(funciona también en el móvil, porque GitHub Pages se sirve por HTTPS).

## Qué se aprende

Detectar una mano ya no es difícil: el modelo da 21 puntos por mano en cada fotograma. Lo difícil
en un entorno inteligente es decidir **cuándo un movimiento es una orden**. En un salón la gente
gesticula, coge un vaso o se toca la cara, y el sistema no debería reaccionar a nada de eso.

Es el **problema de Midas** (Jacob, 1990): como el rey Midas, que convertía en oro todo lo que
tocaba, una interfaz que responde a cualquier movimiento acaba actuando cuando nadie se lo ha
pedido. La versión de `index.js` es **deliberadamente ingenua** para que se pueda romper,
mejorar y medir cuánto mejora.

## Cómo funciona

```
Cámara → HandLandmarker (21 puntos por mano) → dibujo y panel de resultados → pinza → lámpara
```

1. **Importar** MediaPipe Tasks Vision (versión fijada, 1.2.2).
2. **Crear** la tarea `HandLandmarker` en modo `VIDEO`, hasta 2 manos, con GPU si se puede y si no
   con CPU.
3. **Ejecutar** `detectForVideo()` solo cuando llega un fotograma nuevo de la cámara.
4. **Entender** el resultado, que tiene tres listas paralelas (una entrada por mano):
   - `handedness`: mano izquierda o derecha (de la persona) y su confianza.
   - `landmarks`: los 21 puntos en coordenadas de imagen normalizadas (0–1).
   - `worldLandmarks`: los mismos puntos en metros, con el origen en el centro de la mano.
5. **Utilizar** los puntos: se dibuja el esqueleto de cada mano sobre el vídeo.
6. **Convertir en una acción**: se calcula la medida de la pinza y, si baja del umbral, la
   lámpara cambia.

### La medida de la pinza

```js
pinchRatio = distancia(pulgar TIP 4, índice TIP 8) / distancia(muñeca 0, corazón MCP 9)
```

Usa `worldLandmarks` y divide por el tamaño de la mano, así que no depende de lo lejos que esté
la persona ni del tamaño de su mano. Con la mano abierta ronda 1; con una pinza debería bajar
mucho. El umbral está en `PINCH_THRESHOLD` (`index.js`) y hay que **calibrarlo** mirando el
valor de «Pinza» en el panel.

La versión ingenua solo hace bien una cosa: la lámpara cambia al **empezar** la pinza, no en cada
fotograma. Por lo demás vale cualquier mano, un solo umbral y un solo fotograma.

## Panel de resultados

| Campo | Qué muestra |
| --- | --- |
| Manos detectadas | Cuántas manos ve el modelo |
| Mano izquierda / derecha | Confianza y posición de la muñeca |
| Pinza | Valor de `pinchRatio` (el menor si hay dos manos) |
| Activaciones | Cuántas veces ha cambiado la lámpara |
| Fotogramas por segundo | Fotogramas procesados realmente |

## Cómo ejecutarlo

1. Abre esta carpeta en VS Code y lanza `index.html` con Live Server (no funciona con `file://`).
2. Pulsa «Activar cámara» y da permiso.
3. Muestra una o dos manos: se dibujan los 21 puntos de cada una. Haz una pinza para encender o
   apagar la lámpara.

## El reto de Midas

Por parejas: una persona quiere usar la lámpara y la otra intenta que cambie sin querer, solo con
gestos naturales (hablar gesticulando, beber, mirar el móvil, tocarse la cara…).

1. **Medir la versión ingenua**: aciertos en 10 pinzas, activaciones involuntarias en 2 minutos y
   tiempo de reacción.
2. **Mejorar** `updateLamp()` con al menos dos defensas: varios fotogramas seguidos, histéresis
   (un umbral para entrar y otro más alto para salir), tiempo de espera tras un cambio, zona de
   activación, una sola mano, gesto de activación o retroalimentación antes de actuar.
3. **Volver a medir** y comparar las dos versiones.

## Notas

- **La posición de la cámara importa.** Con la cámara abajo (por ejemplo, en el teclado), el
  pulgar y el índice quedan alineados en profundidad y la `z` estimada es poco fiable: la pinza
  puede dar valores altos aunque los dedos se toquen. Prueba la pinza de perfil, aleja la mano o
  calcula la distancia solo con `x` e `y`.
- Para comparar GPU y CPU, añade `?delegate=cpu` a la URL y mira los fotogramas por segundo.
- En el móvil hace falta HTTPS (por ejemplo, GitHub Pages).
- MediaPipe Tasks Vision está fijado en la versión 1.2.2: el `.mjs` y la carpeta `wasm` deben ser
  de la misma versión.
- La imagen se ve en espejo solo por CSS; el modelo recibe la imagen sin voltear, así que
  izquierda y derecha son las de la persona.

## Ficheros

- `index.html`: estructura de la página (vídeo, canvas, lámpara y panel).
- `style.css`: estilos, vídeo y canvas superpuestos y en espejo.
- `index.js`: carga del modelo, cámara, detección, dibujo y lógica de la lámpara.

## Referencia

Jacob, R. J. K. (1990). What you look at is what you get: eye movement-based interaction
techniques. *CHI '90*, 11–18. https://doi.org/10.1145/97243.97246
