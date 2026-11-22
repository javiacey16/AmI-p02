// P2 · The living-room gesture remote
// Camera → HandLandmarker (21 points per hand) → OUR GESTURES → actions on the video player
// The gesture logic goes in section 6, recognizeGestures()

// 1. Import what the task needs.
// Pinned version (never @latest): the .mjs and the .wasm files must be the same version
import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs";
// Reusable gesture helpers (finger, palm and motion measures)
import { FINGER_NAMES, HoldGesture, MotionTracker, maxLongFinger, measureHand } from "./gestures.js";

const MEDIAPIPE_VERSION = "1.2.2"; // same as in the import above
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

/**
 * Shows a status message on the page and in the console.
 * @param {string} message Text to show.
 * @returns {void}
 */
function show(message) {
  statusEl.textContent = message;
  console.log(message);
}

/**
 * Sets the text of an element, touching the DOM only if the text changes.
 * @param {string} id Id of the element.
 * @param {string} text New text.
 * @returns {void}
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el.textContent !== text) el.textContent = text;
}

/**
 * Summarises the environment: MediaPipe version, delegate, secure context and WebGPU.
 * @returns {string} One line per item, ready for show().
 */
function environmentReport() {
  const yesNo = (value) => (value ? "sí" : "no");
  return [
    `MediaPipe Tasks Vision ${MEDIAPIPE_VERSION} · delegado: ${delegate}`,
    `Contexto seguro (necesario para la cámara): ${yesNo(window.isSecureContext)}`,
    `WebGPU: ${yesNo("gpu" in navigator)}`,
  ].join("\n");
}

// 2. Create the task
/**
 * Creates the HandLandmarker task (up to 2 hands, VIDEO mode), trying the GPU first and then
 * the CPU. Add ?delegate=cpu to the URL to force the CPU.
 * @returns {Promise<void>} Resolves when the task is ready; sets `handLandmarker` and `delegate`.
 * @throws {Error} If the task cannot be created with any delegate.
 */
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

/**
 * Turns on the front camera (ideally 640×480) and sizes the canvas and the motion trackers
 * to its real resolution.
 * @returns {Promise<void>} Resolves when the camera is playing.
 * @throws {Error} If the camera is not available (e.g. the page is not served over HTTPS).
 */
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
  // Landmark x and y are normalised by width and height: the trackers need the aspect ratio
  for (const tracker of Object.values(trackers)) tracker.aspect = video.videoWidth / video.videoHeight;
}

// 3. Run the task on every new frame
/**
 * Main loop: runs the model on each new camera frame, then draws, shows results and
 * recognises gestures. Schedules itself with requestAnimationFrame.
 * @returns {void}
 */
function predictWebcam() {
  // detectForVideo needs increasing timestamps: only process new frames
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

// 4. Understand the results: three parallel lists, one entry per detected hand
/**
 * Shows how many hands there are and, for each, its handedness confidence and wrist position.
 * @param {object} result HandLandmarkerResult of the current frame.
 * @returns {void}
 */
function showResults(result) {
  setText("numHands", String(result.landmarks.length));
  const text = { Left: "–", Right: "–" };
  result.handedness.forEach((categories, i) => {
    const { categoryName, score } = categories[0]; // "Left" or "Right": the person's hand
    const wrist = result.landmarks[i][0]; // point 0: wrist, normalised coordinates
    const where = `(${wrist.x.toFixed(2)}, ${wrist.y.toFixed(2)})`;
    text[categoryName] = Math.round(score * 100) + " % · muñeca en " + where;
  });
  setText("leftHand", text.Left);
  setText("rightHand", text.Right);
}

// 5. Use the results
/**
 * Draws each hand on the canvas: the connections between joints and a circle per landmark.
 * @param {object} result HandLandmarkerResult of the current frame.
 * @returns {void}
 */
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

// 6. OUR WORK: from landmarks to gestures

/** Wrist motion of each hand over the last half second (dynamic gestures). */
const trackers = {
  Right: new MotionTracker({ windowMs: 500 }),
  Left: new MotionTracker({ windowMs: 500 }),
};

/**
 * What is switched on. Changed with the toggle buttons on the page, so the same code can be
 * measured with and without each part.
 */
const settings = {
  activation: true, // commands are only accepted for a while after the activation gesture
  defenses: false, // Midas touch defences
};

/**
 * Activation gesture: right hand open (4 long fingers extended), palm towards the camera,
 * fingers up and STILL for `holdMs`. Being still is what tells it apart from forward/backward,
 * which uses the same open hand but moving. CALIBRATE these values with the measures panel.
 */
const ACTIVATION = {
  holdMs: 1000, // how long the pose must be held
  activeMs: 5000, // how long the remote stays active (renewed by every accepted command)
  palmMin: 0.5, // palm towards the camera (palm measure, −1…+1)
  upMin: 0.6, // fingers pointing up (up measure, −1…+1)
  maxMotion: 0.5, // max wrist displacement, in hand sizes per 0.5 s, to count as still
  // Defences (only when settings.defenses is on):
  keepFingers: 3, // hysteresis: once holding, 3 extended long fingers are enough to keep holding
  keepPalm: 0.3, // hysteresis: looser palm threshold to keep holding
  graceMs: 200, // tolerance: short detection drops do not restart the hold
};

/** State of the remote: until when it is active (performance.now() time). */
const remote = { activeUntil: 0 };

/**
 * Close the video: right fist (the four long fingers tightly closed; the thumb is ignored
 * because it is the least reliable finger). Two measures, both taken from the MOST open long
 * finger, so all four have to be closed:
 *   - ratio: dist(wrist, tip) / dist(wrist, PIP), below 1 when the finger is bent
 *   - tip: dist(tip, MCP) / hand size, small only when the tip touches the palm (a half-closed
 *     hand also bends the fingers, but its tips stay far from the knuckles)
 * CALIBRATE these values with the measures panel.
 */
const FIST = {
  enterRatio: 0.9, // most open finger ratio below this…
  enterTip: 0.5, // …and most open fingertip closer to its knuckle than this → fist
  // Defences (only when settings.defenses is on):
  keepRatio: 1.0, // hysteresis: once holding, looser thresholds keep the fist
  keepTip: 0.6,
  holdMs: 400, // the fist must be held this long (otherwise it fires on the first frame)
  graceMs: 150, // tolerance: short detection drops do not restart the hold
};

/** Hold-to-trigger state of each static gesture. */
const holds = {
  activation: new HoldGesture(),
  fist: new HoldGesture(),
};

/**
 * Recognises the gestures and triggers the player actions. Called once per frame.
 * The result holds, for each hand i:
 *   result.handedness[i][0].categoryName → "Left" or "Right" (the person's hand)
 *   result.landmarks[i]      → 21 points, x and y normalised (0–1) in the image
 *   result.worldLandmarks[i] → the same 21 points in metres
 * Use the section 7 actions (seek, changeVolume, closePlayer, togglePause, toggleMute) and
 * setMode() to show whether the remote is active.
 * @param {object} result HandLandmarkerResult of the current frame.
 * @returns {void}
 */
function recognizeGestures(result) {
  const now = performance.now();
  const right = findHand(result, "Right");
  const left = findHand(result, "Left");

  // Measures of each hand (null if missing) and tracking of its motion
  const measures = {};
  for (const [name, hand] of [["Right", right], ["Left", left]]) {
    if (hand) {
      measures[name] = measureHand(hand, name);
      trackers[name].push(now, hand.landmarks);
    } else {
      measures[name] = null;
      trackers[name].clear(); // if the hand is lost, motion starts again from zero
    }
  }
  showMeasures(measures);

  const active = updateActivation(now, measures);
  if (!active) {
    // The remote is idle: ignore every command and forget any hold in progress
    holds.fist.reset();
    return;
  }

  updateFist(now, measures.Right);

  // TODO: forward/backward, volume and our two own gestures. Call keepActive() after each
  // accepted command. For example:
  //   const { dx } = trackers.Right.displacement(); if (dx > 1) → right hand moving right
}

/**
 * Close gesture: a right fist closes the video. Without defences it fires on the first frame
 * the fist is seen; with defences it must be held FIST.holdMs (with hysteresis and a grace
 * period) and the remote shows the progress so the person can abort.
 * @param {number} now Current time in milliseconds (performance.now()).
 * @param {object | null} m Output of measureHand() for the right hand, or null if missing.
 * @returns {void}
 */
function updateFist(now, m) {
  const defended = settings.defenses;
  const loose = defended && holds.fist.holding; // hysteresis while holding
  // Values of the most open long finger: if it is closed, all four are
  const isFist =
    m !== null &&
    maxLongFinger(m.ratios) < (loose ? FIST.keepRatio : FIST.enterRatio) &&
    maxLongFinger(m.tips) < (loose ? FIST.keepTip : FIST.enterTip);
  const { fired, progress } = holds.fist.update(now, isFist, {
    holdMs: defended ? FIST.holdMs : 0,
    graceMs: defended ? FIST.graceMs : 0,
  });

  if (fired) {
    if (!player.hidden) closePlayer(); // already closed: nothing to do, nothing to log
    keepActive(now);
  } else if (defended && holds.fist.holding) {
    setMode(`Cerrando el vídeo… ${Math.round(progress * 100)} %`, true, true);
  }
}

/**
 * Checks whether a hand is in the activation pose: open, palm towards the camera, fingers up
 * and still. With defences on, an ongoing hold uses looser thresholds (hysteresis).
 * @param {object | null} m Output of measureHand() for the right hand, or null if missing.
 * @param {MotionTracker} tracker Motion tracker of the same hand.
 * @param {boolean} holding Whether an activation hold is already in progress.
 * @returns {boolean} true if the pose is detected in this frame.
 */
function isActivationPose(m, tracker, holding) {
  if (!m) return false;
  const loose = holding && settings.defenses;
  const { dx, dy } = tracker.displacement();
  const fingersOpen = loose ? m.longFingers >= ACTIVATION.keepFingers : m.longFingers === 4;
  const palmToCamera = m.palm > (loose ? ACTIVATION.keepPalm : ACTIVATION.palmMin);
  const fingersUp = m.up > ACTIVATION.upMin;
  const still = Math.abs(dx) < ACTIVATION.maxMotion && Math.abs(dy) < ACTIVATION.maxMotion;
  return fingersOpen && palmToCamera && fingersUp && still;
}

/**
 * Runs the activation gesture for this frame and shows the state of the remote.
 * Holding the pose for ACTIVATION.holdMs activates the remote for ACTIVATION.activeMs.
 * With defences on: hysteresis and a short grace period while holding, and progress feedback.
 * @param {number} now Current time in milliseconds (performance.now()).
 * @param {{Right: object | null, Left: object | null}} measures Output of measureHand() per hand.
 * @returns {boolean} true if the remote accepts commands in this frame.
 */
function updateActivation(now, measures) {
  if (!settings.activation) {
    setMode("Mando siempre activo (gesto de activación desactivado)", true);
    return true;
  }

  const hold = holds.activation;
  const pose = isActivationPose(measures.Right, trackers.Right, hold.holding);
  // The 1 s hold is part of the gesture; without defences, a single missed frame restarts it.
  // After firing, keeping the hand up does not re-activate every second (it must be released).
  const { fired, progress } = hold.update(now, pose, {
    holdMs: ACTIVATION.holdMs,
    graceMs: settings.defenses ? ACTIVATION.graceMs : 0,
  });
  if (fired) {
    remote.activeUntil = now + ACTIVATION.activeMs;
    logAction("activar mando", `${ACTIVATION.activeMs / 1000} s`);
  }

  const active = now < remote.activeUntil;
  if (active) {
    const left = Math.ceil((remote.activeUntil - now) / 1000);
    setMode(`Mando activado: ${left} s`, true);
  } else if (hold.holding && settings.defenses) {
    // Feedback (defence): the person sees it is about to activate and can abort
    setMode(`Activando… ${Math.round(progress * 100)} %`, false, true);
  } else {
    setMode("Mando en reposo · mano derecha abierta y quieta 1 s para activar", false);
  }
  return active;
}

/**
 * Renews the active period. Call it after every accepted command, so the remote stays active
 * while the person keeps using it.
 * @param {number} [now=performance.now()] Current time in milliseconds.
 * @returns {void}
 */
function keepActive(now = performance.now()) {
  if (settings.activation) remote.activeUntil = now + ACTIVATION.activeMs;
}

/**
 * Puts the remote back to idle (used when the settings change).
 * @returns {void}
 */
function resetRemote() {
  remote.activeUntil = 0;
  for (const hold of Object.values(holds)) hold.reset();
}

/**
 * Calibration panel: shows the measures of each hand so the thresholds can be chosen.
 * @param {{Right: object | null, Left: object | null}} measures Output of measureHand() per hand,
 *   or null when the hand is not detected.
 * @returns {void}
 */
function showMeasures(measures) {
  const mark = (on) => (on ? "▲" : "·"); // ▲ extended, · bent
  for (const [name, id] of [["Right", "measureRight"], ["Left", "measureLeft"]]) {
    const m = measures[name];
    if (!m) {
      setText(id, "–");
      continue;
    }
    const { dx, dy } = trackers[name].displacement();
    setText(
      id,
      [
        `dedos      ${FINGER_NAMES.map((f) => mark(m.fingers[f])).join(" ")}   (pulgar índice corazón anular meñique)`,
        `ratios     ${FINGER_NAMES.map((f) => m.ratios[f].toFixed(2)).join("  ")}`,
        `puntas     ${["index", "middle", "ring", "pinky"].map((f) => m.tips[f].toFixed(2)).join("  ")}   (punta–nudillo / mano: índice corazón anular meñique)`,
        `puño       ratio máx ${maxLongFinger(m.ratios).toFixed(2)}  punta máx ${maxLongFinger(m.tips).toFixed(2)}`,
        `palma      ${m.palm.toFixed(2)}   (+1 hacia la cámara, −1 de espaldas)`,
        `arriba     ${m.up.toFixed(2)}   (+1 dedos hacia arriba)`,
        `movimiento dx ${dx.toFixed(2)}  dy ${dy.toFixed(2)}   (manos/0,5 s, derecha y arriba en pantalla)`,
      ].join("\n"),
    );
  }
}

/**
 * Finds one hand in the result.
 * @param {object} result HandLandmarkerResult of the current frame.
 * @param {"Left" | "Right"} name The person's hand to look for.
 * @returns {{landmarks: object[], world: object[]} | null} Its image and world landmarks,
 *   or null if that hand is not detected.
 */
function findHand(result, name) {
  const i = result.handedness.findIndex((categories) => categories[0].categoryName === name);
  return i < 0 ? null : { landmarks: result.landmarks[i], world: result.worldLandmarks[i] };
}

/**
 * Shows the state of the remote (e.g. "Mando activado: 3 s").
 * @param {string} text Text to show.
 * @param {boolean} active Whether the remote is active (changes the style).
 * @param {boolean} [pending=false] Whether it is about to activate (changes the style).
 * @returns {void}
 */
function setMode(text, active, pending = false) {
  setText("mode", text);
  modeEl.classList.toggle("active", Boolean(active));
  modeEl.classList.toggle("pending", Boolean(pending));
}

/**
 * Connects a toggle button to a key of `settings`: each click switches it, updates the button,
 * logs the change (so the CSV shows which version was being measured) and resets the remote.
 * @param {string} id Id of the button.
 * @param {keyof typeof settings} key Setting the button switches.
 * @param {string} label Text of the button, before ": sí" / ": no".
 * @returns {void}
 */
function setupToggle(id, key, label) {
  const button = document.getElementById(id);
  const render = () => {
    button.setAttribute("aria-pressed", String(settings[key]));
    button.textContent = `${label}: ${settings[key] ? "sí" : "no"}`;
  };
  button.addEventListener("click", () => {
    settings[key] = !settings[key];
    render();
    resetRemote();
    logAction("configuración", `${label.toLowerCase()}: ${settings[key] ? "sí" : "no"}`);
  });
  render();
}

setupToggle("btnActivation", "activation", "Gesto de activación");
setupToggle("btnDefenses", "defenses", "Defensas");

/**
 * Shows the player again after the close gesture, so the next attempt can be measured.
 * It is logged as a manual action to tell it apart from the gestures.
 * @returns {void}
 */
function reopenPlayer() {
  if (!player.hidden) return;
  player.hidden = false;
  logAction("reabrir (manual)", "");
}

document.querySelector("#btnReopen").addEventListener("click", reopenPlayer);

// 7. Actions on the player (already implemented; each one is logged)

/**
 * Limits a value to a range.
 * @param {number} value Value to limit.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @returns {number} value, clamped to [min, max].
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Jumps forwards or backwards in the video and logs it.
 * @param {number} seconds Seconds to move: positive forwards, negative backwards.
 * @returns {void}
 */
function seek(seconds) {
  const end = Number.isFinite(player.duration) ? player.duration : Infinity; // not loaded yet
  player.currentTime = clamp(player.currentTime + seconds, 0, end);
  logAction(seconds > 0 ? "avanzar" : "retroceder", `${seconds} s → ${player.currentTime.toFixed(1)} s`);
}

/**
 * Changes the volume and logs it.
 * @param {number} delta Volume change (the volume goes from 0 to 1): positive up, negative down.
 * @returns {void}
 */
function changeVolume(delta) {
  player.volume = clamp(player.volume + delta, 0, 1);
  logAction(delta > 0 ? "subir volumen" : "bajar volumen", `volumen ${player.volume.toFixed(2)}`);
}

/**
 * Stops and hides the player, and logs it.
 * @returns {void}
 */
function closePlayer() {
  player.pause();
  player.hidden = true;
  logAction("cerrar", "");
}

/**
 * Pauses the video if it is playing, or resumes it if paused, and logs it.
 * @returns {void}
 */
function togglePause() {
  if (player.paused) player.play();
  else player.pause();
  logAction(player.paused ? "pausar" : "reanudar", "");
}

/**
 * Mutes or unmutes the video and logs it.
 * @returns {void}
 */
function toggleMute() {
  player.muted = !player.muted;
  logAction(player.muted ? "silenciar" : "quitar silencio", "");
}

/** Action log: rows of [seconds since page load, action, detail]. */
const logRows = [];

/**
 * Adds an action to the log and to the table on the page (newest first).
 * @param {string} action Name of the action (e.g. "avanzar").
 * @param {string} detail Extra information (e.g. the new time or volume).
 * @returns {void}
 */
function logAction(action, detail) {
  const row = [(performance.now() / 1000).toFixed(2), action, detail];
  logRows.push(row);
  const tr = document.createElement("tr");
  for (const value of row) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(td);
  }
  logBody.prepend(tr); // newest action on top
}

/**
 * Downloads the action log as a CSV file (registro-acciones.csv).
 * @returns {void}
 */
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

/**
 * Counts processed frames and updates the frames-per-second value once per second.
 * @returns {void}
 */
function countFrame() {
  frames++;
  const elapsed = performance.now() - fpsStart;
  if (elapsed >= 1000) {
    setText("fps", (frames / (elapsed / 1000)).toFixed(1));
    frames = 0;
    fpsStart = performance.now();
  }
}

/**
 * Starts the app: creates the task, shows the environment report and enables the camera
 * button (the camera starts on click, since some browsers require a user gesture).
 * @returns {Promise<void>} Resolves when the button is ready.
 */
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
