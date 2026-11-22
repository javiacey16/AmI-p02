// P2 · El mando gestual del salón (plantilla)
// Cámara → HandLandmarker (21 puntos por mano) → VUESTROS GESTOS → acciones sobre el reproductor
// Lo que tenéis que programar está en la sección 6, recognizeGestures()

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
const player = document.querySelector("#player");
const modeEl = document.querySelector("#mode");
const logBody = document.querySelector("#log tbody");

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
    recognizeGestures(result);
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

// 6. VUESTRO TRABAJO: de los puntos a los gestos
// Se llama una vez por fotograma con el resultado de HandLandmarker:
//   result.handedness[i][0].categoryName → "Left" o "Right" (la mano de la persona)
//   result.landmarks[i]      → 21 puntos, x e y normalizadas (0–1) en la imagen
//   result.worldLandmarks[i] → los mismos 21 puntos en metros
// Usad las acciones de la sección 7 (seek, changeVolume, closePlayer, togglePause,
// toggleMute) y setMode() para mostrar si el mando está activado.
function recognizeGestures(result) {
  const right = findHand(result, "Right");
  const left = findHand(result, "Left");
  // TODO: gesto de activación, los tres gestos del estudio, vuestros dos gestos
  // y las defensas contra el problema de Midas
}

// Devuelve { landmarks, world } de la mano pedida ("Left" o "Right"), o null si no está
function findHand(result, name) {
  const i = result.handedness.findIndex((categories) => categories[0].categoryName === name);
  return i < 0 ? null : { landmarks: result.landmarks[i], world: result.worldLandmarks[i] };
}

// Distancia entre dos puntos 3D
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Muestra el estado del mando (por ejemplo, "Mando activado: 3 s")
function setMode(text, active) {
  setText("mode", text);
  modeEl.classList.toggle("active", Boolean(active));
}

// 7. Acciones sobre el reproductor (ya implementadas; cada una queda en el registro)
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seek(seconds) {
  const end = Number.isFinite(player.duration) ? player.duration : Infinity; // aún sin cargar
  player.currentTime = clamp(player.currentTime + seconds, 0, end);
  logAction(seconds > 0 ? "avanzar" : "retroceder", `${seconds} s → ${player.currentTime.toFixed(1)} s`);
}

function changeVolume(delta) {
  player.volume = clamp(player.volume + delta, 0, 1);
  logAction(delta > 0 ? "subir volumen" : "bajar volumen", `volumen ${player.volume.toFixed(2)}`);
}

function closePlayer() {
  player.pause();
  player.hidden = true;
  logAction("cerrar", "");
}

function togglePause() {
  if (player.paused) player.play();
  else player.pause();
  logAction(player.paused ? "pausar" : "reanudar", "");
}

function toggleMute() {
  player.muted = !player.muted;
  logAction(player.muted ? "silenciar" : "quitar silencio", "");
}

// Registro de acciones: tiempo desde que se cargó la página, acción y detalle
const logRows = [];

function logAction(action, detail) {
  const row = [(performance.now() / 1000).toFixed(2), action, detail];
  logRows.push(row);
  const tr = document.createElement("tr");
  for (const value of row) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(td);
  }
  logBody.prepend(tr); // la acción más reciente, arriba
}

function downloadLog() {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const lines = [["tiempo_s", "accion", "detalle"], ...logRows].map((row) => row.map(quote).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "registro-acciones.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

document.querySelector("#btnDownload").addEventListener("click", downloadLog);
document.querySelector("#btnClear").addEventListener("click", () => {
  logRows.length = 0;
  logBody.replaceChildren();
});

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
