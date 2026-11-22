// Tutorial 4 · Puntos clave de las manos con MediaPipe Hand Landmarker
// Cámara → HandLandmarker (21 puntos por mano) → dibujo y resultados → pinza que enciende una lámpara

// 1. Importar los elementos necesarios para la tarea.
// Versión fijada (nunca @latest): el .mjs y los ficheros .wasm deben ser de la misma versión
import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs";

const MEDIAPIPE_VERSION = "1.2.2"; // la misma que en el import de arriba
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const statusEl = document.querySelector("#status");
const btnCamera = document.querySelector("#btnCamera");
const video = document.querySelector("#webcam");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const lampEl = document.querySelector("#lamp");

let handLandmarker;
let delegate;
let drawingUtils;
let lastVideoTime = -1;
let frames = 0;
let fpsStart = performance.now();

function show(message) {
  statusEl.textContent = message;
  console.log(message);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el.textContent !== text) el.textContent = text; // solo tocamos el DOM si cambia
}

function environmentReport() {
  const yesNo = (value) => (value ? "sí" : "no");
  return [
    `MediaPipe Tasks Vision ${MEDIAPIPE_VERSION} · delegado: ${delegate}`,
    `Contexto seguro (necesario para la cámara): ${yesNo(window.isSecureContext)}`,
    `WebGPU: ${yesNo("gpu" in navigator)}`,
  ].join("\n");
}

// 2. Crear la tarea (con GPU si se puede; si no, CPU).
// Para comparar, añade ?delegate=cpu a la URL
async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    numHands: 2,
  };
  const requested = new URLSearchParams(location.search).get("delegate")?.toUpperCase();
  const candidates = requested === "CPU" ? ["CPU"] : ["GPU", "CPU"];
  for (const candidate of candidates) {
    try {
      options.baseOptions.delegate = candidate;
      handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      delegate = candidate;
      return;
    } catch (error) {
      console.warn(`No se pudo crear la tarea con ${candidate}:`, error);
    }
  }
  throw new Error("No se pudo crear HandLandmarker");
}

// Activar la cámara web y ajustar el canvas a su resolución real
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("La cámara no está disponible (¿se sirve la página por HTTPS?)");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  drawingUtils = new DrawingUtils(ctx);
}

// 3. Ejecutar la tarea en cada fotograma nuevo
function predictWebcam() {
  // detectForVideo necesita marcas de tiempo crecientes: solo procesamos fotogramas nuevos
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    drawResults(result);
    showResults(result);
    updateLamp(result);
    countFrame();
  }
  requestAnimationFrame(predictWebcam);
}

// 4. Entender los resultados: tres listas paralelas, una entrada por mano detectada
function showResults(result) {
  setText("numHands", String(result.landmarks.length));
  const text = { Left: "–", Right: "–" };
  result.handedness.forEach((categories, i) => {
    const { categoryName, score } = categories[0]; // "Left" o "Right": la mano de la persona
    const wrist = result.landmarks[i][0]; // punto 0: muñeca, coordenadas normalizadas
    const where = `(${wrist.x.toFixed(2)}, ${wrist.y.toFixed(2)})`;
    text[categoryName] = Math.round(score * 100) + " % · muñeca en " + where;
  });
  setText("leftHand", text.Left);
  setText("rightHand", text.Right);
}

// 5. Utilizar los resultados: dibujar las conexiones entre articulaciones y un círculo en cada punto
function drawResults(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const landmarks of result.landmarks) {
    drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: "#00e0ff",
      lineWidth: 3,
    });
    drawingUtils.drawLandmarks(landmarks, { color: "#ff6f00", lineWidth: 1, radius: 4 });
  }
}

// 6. De los puntos a una acción: encender y apagar la lámpara con una pinza
const PINCH_THRESHOLD = 0.4; // por debajo de este valor hay pinza (calíbralo mirando el panel)
let wasPinching = false;
let lampOn = false;
let activations = 0;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Distancia pulgar–índice (4–8) relativa al tamaño de la mano (muñeca–MCP del corazón, 0–9).
// Con worldLandmarks (metros) y relativa a la mano, no depende de lo lejos que esté la persona
function pinchRatio(world) {
  return distance(world[4], world[8]) / distance(world[0], world[9]);
}

// Primera versión, ingenua: cualquier mano, un solo umbral y un solo fotograma
function updateLamp(result) {
  const ratios = result.worldLandmarks.map(pinchRatio);
  const ratio = ratios.length > 0 ? Math.min(...ratios) : Infinity;
  setText("pinch", Number.isFinite(ratio) ? ratio.toFixed(2) : "–");

  const isPinching = ratio < PINCH_THRESHOLD;
  if (isPinching && !wasPinching) toggleLamp(); // solo al empezar la pinza, no en cada fotograma
  wasPinching = isPinching;
}

function toggleLamp() {
  lampOn = !lampOn;
  lampEl.classList.toggle("on", lampOn);
  lampEl.textContent = lampOn ? "Lámpara encendida" : "Lámpara apagada";
  activations++;
  setText("activations", String(activations));
}

function countFrame() {
  frames++;
  const elapsed = performance.now() - fpsStart;
  if (elapsed >= 1000) {
    setText("fps", (frames / (elapsed / 1000)).toFixed(1));
    frames = 0;
    fpsStart = performance.now();
  }
}

async function app() {
  await createHandLandmarker();
  show(environmentReport());
  btnCamera.disabled = false;
  btnCamera.addEventListener("click", async () => {
    btnCamera.disabled = true;
    try {
      await startCamera();
      btnCamera.hidden = true;
      requestAnimationFrame(predictWebcam);
    } catch (error) {
      console.error(error);
      show(`Error con la cámara: ${error.message}`);
      btnCamera.disabled = false;
    }
  });
}

try {
  await app();
} catch (error) {
  console.error(error);
  show(`Error: ${error.message}`);
}
