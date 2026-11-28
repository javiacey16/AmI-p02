# AmI-p02 · Gestos de las manos con MediaPipe

Práctica 2 de Inteligencia Ambiental (Máster Universitario en Inteligencia Artificial Aplicada,
Universidad Carlos III de Madrid, curso 2026/27).

El proyecto convierte la cámara web en un **mando gestual para la televisión del salón**. MediaPipe
Hand Landmarker detecta las manos en el navegador y la aplicación reconoce gestos para controlar un
vídeo, con defensas contra el **problema de Midas**: que el mando no reaccione a los movimientos
normales de una persona sentada en el sofá.

## Contenido

| Carpeta | Qué contiene | En línea |
| --- | --- | --- |
| [`AmI-p02/`](AmI-p02/) | La aplicación de la práctica: el mando gestual con seis gestos, el gesto de activación y las defensas | https://javiacey16.github.io/AmI-p02/AmI-p02/ |
| [`AmI-p02-t04/`](AmI-p02-t04/) | Tutorial 4: detección de manos y una lámpara que se enciende con una pinza, en versión ingenua | https://javiacey16.github.io/AmI-p02/AmI-p02-t04/ |
| [`elicitacion/`](elicitacion/) | Guion de la mini elicitación con la que se eligieron los gestos de pausar y silenciar | |
| [`memoria/`](memoria/) | Memoria de la práctica en PDF | |

## Ejecución local

Las dos aplicaciones son páginas estáticas sin compilación. Basta con servir su carpeta con un
servidor local (por ejemplo, Live Server en VS Code o `npx serve`) y abrir `index.html`. La cámara
necesita HTTPS o `localhost`, así que no funcionan abriendo el fichero directamente.

Los detalles de cada una están en su propio README:

- [Mando gestual del salón](AmI-p02/README.md): gestos, defensas, interfaz y estructura del código.
- [Tutorial 4](AmI-p02-t04/README.md): cómo funciona MediaPipe Hand Landmarker y la medida de la pinza.

## Entregables

- Código fuente: este repositorio.
- Memoria: [`memoria/P2_Memoria.pdf`](memoria/P2_Memoria.pdf).
- Vídeo de demostración: se entrega aparte, en el mismo archivo comprimido que la memoria.

## Tecnología

- [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
  1.2.2 (Hand Landmarker), cargado desde jsDelivr.
- HTML, CSS y JavaScript con módulos ES, sin dependencias de compilación.
- Despliegue en GitHub Pages.
