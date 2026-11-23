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
import {
  FINGER_NAMES,
  LM,
  HoldGesture,
  circleMeasure,
  MotionTracker,
  StrokeGate,
  matchesPattern,
  maxLongFinger,
  measureHand,
} from "./gestures.js";

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
 * @returns {string} A single line, ready for show() (it fits the status pill of the header).
 */
function environmentReport() {
  const yesNo = (value) => (value ? "sí" : "no");
  return [
    `MediaPipe ${MEDIAPIPE_VERSION}`,
    delegate,
    `contexto seguro: ${yesNo(window.isSecureContext)}`,
    `WebGPU: ${yesNo("gpu" in navigator)}`,
  ].join(" · ");
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

/**
 * Motion trackers: the wrist of each hand over the last half second (swipes, volume, stillness)
 * and the right index fingertip over the last two seconds (circle).
 */
const trackers = {
  Right: new MotionTracker({ windowMs: 500 }),
  Left: new MotionTracker({ windowMs: 500 }),
  circle: new MotionTracker({ windowMs: 2000, point: LM.INDEX_TIP }),
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

/**
 * Forward / backward: right hand open with the fingers up, moved sideways. Moving it to the
 * right (as seen on screen) jumps forward; to the left, backward. One swipe = one jump.
 * CALIBRATE these values with the measures panel ("movimiento" line).
 */
const SWIPE = {
  seekSeconds: 10, // size of each jump
  minDx: 1.0, // horizontal wrist displacement within 0.5 s, in hand sizes
  dominance: 2, // the horizontal movement must be this many times the vertical one
  upMin: 0.5, // fingers roughly up (looser than activation: the hand tilts while moving)
  // Defences (only when settings.defenses is on):
  sameDirMs: 400, // after a jump, wait this long before another jump in the SAME direction
  reverseMs: 1200, // …and this long before a jump in the OPPOSITE direction, so the hand
  // coming back to swipe again does not jump the other way
  poseMs: 300, // the open hand must be held for the whole swipe, not only in the last frame
};

/** State of the swipe gesture. */
const swipe = {
  gate: new StrokeGate(), // direction-aware waiting between jumps (defence)
  poseSince: null, // since when the open hand has been seen without interruption
};

/**
 * Volume: right hand pointing (index extended, the other long fingers bent) and left hand open
 * with the palm towards the camera. Moving the right hand up raises the volume; down lowers it.
 * One movement = one step. CALIBRATE these values with the measures panel ("movimiento" line).
 */
const VOLUME = {
  step: 0.1, // volume change per movement (the volume goes from 0 to 1: 10 steps)
  minDy: 0.8, // vertical wrist displacement within 0.5 s, in hand sizes
  dominance: 2, // the vertical movement must be this many times the horizontal one
  palmMin: 0.5, // left palm towards the camera (palm measure, −1…+1)
  // Defences (only when settings.defenses is on):
  sameDirMs: 300, // after a step, wait this long before another step in the SAME direction
  reverseMs: 1200, // …and this long before the OPPOSITE direction (the hand coming back)
  poseMs: 300, // both hands must be in the pose for the whole movement
};

/** State of the volume gesture. */
const volume = {
  gate: new StrokeGate(), // direction-aware waiting between steps (defence)
  poseSince: null, // since when both hands have been in the pose without interruption
};

/**
 * Pause / resume (from our mini elicitation): draw a circle with the right index finger, the
 * other fingers closed. Either direction counts. The left palm must NOT be facing the camera,
 * so it is not confused with the volume gesture (same right-hand pose).
 * CALIBRATE these values with the measures panel ("círculo" line).
 */
const CIRCLE = {
  minTurn: 300, // total turning of the fingertip path, in degrees (a full circle is 360)
  minSize: 0.6, // smaller side of the path, in hand sizes (rejects small jitter and lines)
  minRoundness: 0.5, // smaller side / larger side of the path (rejects flat ellipses and lines)
  // Defences (only when settings.defenses is on):
  graceMs: 200, // tolerance: short pose drops do not erase the path drawn so far
  cooldownMs: 1000, // after a toggle, ignore circles (a person who keeps circling toggles once)
  feedbackTurn: 120, // from this turning on, show the progress so the person can stop
};

/** State of the circle gesture. */
const circle = {
  lastPoseAt: -Infinity, // last time the pointing pose was seen
  lastFired: -Infinity, // time of the last toggle
};

/**
 * Mute / unmute (from our mini elicitation): right index finger up, the other fingers closed,
 * palm towards the person (the back of the hand faces the camera), and the hand still.
 * Being still separates it from the circle; the left palm must NOT face the camera, which
 * separates it from the volume gesture. CALIBRATE these values with the measures panel.
 */
const MUTE = {
  palmMax: -0.4, // palm measure below this: back of the hand towards the camera (−1 = fully)
  upMin: 0.5, // fingers pointing up (up measure, −1…+1)
  maxMotion: 0.3, // max wrist displacement, in hand sizes per 0.5 s, to count as still
  // Defences (only when settings.defenses is on):
  keepPalm: -0.2, // hysteresis: once holding, a looser palm threshold keeps the pose
  holdMs: 500, // the pose must be held this long (otherwise it fires on the first frame)
  graceMs: 150, // tolerance: short detection drops do not restart the hold
};

/** Hold-to-trigger state of each static gesture. */
const holds = {
  activation: new HoldGesture(),
  fist: new HoldGesture(),
  mute: new HoldGesture(),
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
    holds.mute.reset();
    swipe.poseSince = null;
    volume.poseSince = null;
    trackers.circle.clear();
    return;
  }

  updateFist(now, measures.Right);
  updateSwipe(now, measures.Right);
  updateVolume(now, measures.Right, measures.Left);
  updateCircle(now, right, measures.Right, measures.Left);
  updateMute(now, measures.Right, measures.Left);
}

/**
 * Forward / backward gesture: a sideways swipe of the open right hand jumps SWIPE.seekSeconds
 * forward (to the right on screen) or backward (to the left). Without defences, any frame with
 * the open hand and enough sideways movement fires, so the hand coming back after a swipe jumps
 * the other way. With defences: a short wait before another jump in the same direction, a longer
 * one before the opposite direction (the return stroke is ignored), and the open hand must have
 * been held for the whole swipe (SWIPE.poseMs).
 * @param {number} now Current time in milliseconds (performance.now()).
 * @param {object | null} m Output of measureHand() for the right hand, or null if missing.
 * @returns {void}
 */
function updateSwipe(now, m) {
  const defended = settings.defenses;
  const openHand = m !== null && m.longFingers === 4 && m.up > SWIPE.upMin;
  if (!openHand) {
    swipe.poseSince = null;
    return;
  }
  swipe.poseSince ??= now;
  if (player.hidden) return; // the video is closed: nothing to move
  if (defended && now - swipe.poseSince < SWIPE.poseMs) return; // hand not open long enough

  const { dx, dy } = trackers.Right.displacement();
  const sideways = Math.abs(dx) >= SWIPE.minDx && Math.abs(dx) >= SWIPE.dominance * Math.abs(dy);
  if (!sideways) return;

  const dir = Math.sign(dx); // +1: to the right on screen → forward; −1: backward
  if (defended && !swipe.gate.allows(now, dir, SWIPE)) {
    // Too soon (e.g. the return stroke): discard this movement so it does not add up
    // with the next swipe
    trackers.Right.clear();
    return;
  }

  seek(dir * SWIPE.seekSeconds);
  swipe.gate.record(now, dir);
  trackers.Right.clear(); // the same movement must not fire again on the next frame
  keepActive(now);
}

/**
 * Volume gesture: with the right hand pointing and the left palm towards the camera, moving the
 * right hand up raises the volume by VOLUME.step and moving it down lowers it. Without defences,
 * any frame with both poses and enough vertical movement fires. With defences: both hands must
 * be in the pose for the whole movement (VOLUME.poseMs), and the direction-aware wait ignores
 * the hand coming back to repeat the gesture.
 * @param {number} now Current time in milliseconds (performance.now()).
 * @param {object | null} right Output of measureHand() for the right hand, or null if missing.
 * @param {object | null} left Output of measureHand() for the left hand, or null if missing.
 * @returns {void}
 */
function updateVolume(now, right, left) {
  const defended = settings.defenses;
  if (!isPointing(right) || !isLeftPalm(left)) {
    volume.poseSince = null;
    return;
  }
  volume.poseSince ??= now;
  if (player.hidden) return; // the video is closed: nothing to change
  if (defended && now - volume.poseSince < VOLUME.poseMs) return; // pose not held long enough

  const { dx, dy } = trackers.Right.displacement();
  const vertical = Math.abs(dy) >= VOLUME.minDy && Math.abs(dy) >= VOLUME.dominance * Math.abs(dx);
  if (!vertical) return;

  const dir = Math.sign(dy); // +1: up → louder; −1: down → quieter
  if (defended && !volume.gate.allows(now, dir, VOLUME)) {
    trackers.Right.clear(); // too soon (e.g. the hand coming back): discard this movement
    return;
  }

  changeVolume(dir * VOLUME.step);
  volume.gate.record(now, dir);
  trackers.Right.clear(); // the same movement must not fire again on the next frame
  keepActive(now);
}

/**
 * Whether a hand points with the index finger only (index extended, the other long fingers
 * bent; the thumb is ignored). Shared by the volume and circle gestures.
 * @param {object | null} m Output of measureHand(), or null if the hand is missing.
 * @returns {boolean} true if the hand is in the pointing pose.
 */
function isPointing(m) {
  return m !== null && matchesPattern(m.fingers, { index: true, middle: false, ring: false, pinky: false });
}

/**
 * Whether the left hand is open with the palm towards the camera (the left half of the volume
 * gesture). The circle and mute gestures require it NOT to be, so they never overlap with volume.
 * @param {object | null} left Output of measureHand() for the left hand, or null if missing.
 * @returns {boolean} true if the left palm faces the camera.
 */
function isLeftPalm(left) {
  return left !== null && left.longFingers === 4 && left.palm > VOLUME.palmMin;
}

/**
 * Mute gesture: the right index finger up with the palm towards the person (back of the hand to
 * the camera), still, toggles the sound. Without defences it fires on the first frame of the
 * pose; with defences it must be held MUTE.holdMs (with hysteresis on the palm and a grace
 * period), and the remote shows the progress so the person can abort.
 * @param {number} now Current time in milliseconds (performance.now()).
 * @param {object | null} right Output of measureHand() for the right hand, or null if missing.
 * @param {object | null} left Output of measureHand() for the left hand, or null if missing.
 * @returns {void}
 */
function updateMute(now, right, left) {
  const defended = settings.defenses;
  const hold = holds.mute;
  const loose = defended && hold.holding; // hysteresis while holding
  const { dx, dy } = trackers.Right.displacement();
  const pose =
    isPointing(right) &&
    !isLeftPalm(left) &&
    right.palm < (loose ? MUTE.keepPalm : MUTE.palmMax) &&
    right.up > MUTE.upMin &&
    Math.abs(dx) < MUTE.maxMotion &&
    Math.abs(dy) < MUTE.maxMotion;

  const { fired, progress } = hold.update(now, pose, {
    holdMs: defended ? MUTE.holdMs : 0,
    graceMs: defended ? MUTE.graceMs : 0,
  });
  if (player.hidden) return; // the video is closed: nothing to mute

  if (fired) {
    toggleMute();
    keepActive(now);
  } else if (defended && hold.holding) {
    // Feedback (defence): the person sees it is about to toggle the sound and can abort
    const what = player.muted ? "Quitando el silencio" : "Silenciando";
    setMode(`${what}… ${Math.round(progress * 100)} %`, true, true);
  }
}

/**
 * Pause / resume gesture: drawing a circle with the right index finger toggles the video.
 * The fingertip path is only recorded while the pointing pose holds and the left palm is not
 * facing the camera (that would be the volume gesture). Without defences, a single frame without
 * the pose erases the path. With defences: a short grace period keeps the path, a cooldown after
 * each toggle, and progress feedback while the circle is being drawn.
 * @param {number} now Current time in milliseconds (performance.now()).
 * @param {{landmarks: object[], world: object[]} | null} hand The right hand from findHand().
 * @param {object | null} right Output of measureHand() for the right hand, or null if missing.
 * @param {object | null} left Output of measureHand() for the left hand, or null if missing.
 * @returns {void}
 */
function updateCircle(now, hand, right, left) {
  const defended = settings.defenses;
  const tracker = trackers.circle;

  if (isPointing(right) && !isLeftPalm(left)) {
    circle.lastPoseAt = now;
    tracker.push(now, hand.landmarks);
  } else if (now - circle.lastPoseAt > (defended ? CIRCLE.graceMs : 0)) {
    tracker.clear(); // pose lost: the circle starts again
    return;
  }
  if (player.hidden) return; // the video is closed: nothing to pause
  if (defended && now - circle.lastFired < CIRCLE.cooldownMs) {
    tracker.clear(); // cooldown: do not keep drawing towards a second toggle
    return;
  }

  const { turn, size, roundness } = circleMeasure(tracker.samples);
  const isCircle = turn >= CIRCLE.minTurn && size >= CIRCLE.minSize && roundness >= CIRCLE.minRoundness;
  if (isCircle) {
    togglePause();
    circle.lastFired = now;
    tracker.clear(); // the same circle must not fire again on the next frame
    keepActive(now);
  } else if (defended && turn >= CIRCLE.feedbackTurn) {
    // Feedback (defence): the person sees the circle is about to toggle the video
    const progress = Math.min(99, Math.round((turn / CIRCLE.minTurn) * 100));
    setMode(`${player.paused ? "Reanudando" : "Pausando"}… ${progress} %`, true, true);
  }
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
    // Already active (e.g. the hand stops after a swipe): just renew, without logging it again
    if (now >= remote.activeUntil) logAction("activar mando", `${ACTIVATION.activeMs / 1000} s`);
    remote.activeUntil = now + ACTIVATION.activeMs;
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
  swipe.gate.reset();
  swipe.poseSince = null;
  volume.gate.reset();
  volume.poseSince = null;
  circle.lastPoseAt = -Infinity;
  circle.lastFired = -Infinity;
  trackers.circle.clear();
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
    const fixed = (value) => value.toFixed(2).padStart(5); // aligned columns
    // Short lines: the legend under the panel explains each one
    const lines = [
      `dedos   ${FINGER_NAMES.map((f) => mark(m.fingers[f]).padStart(5)).join(" ")}`,
      `ratios  ${FINGER_NAMES.map((f) => fixed(m.ratios[f])).join(" ")}`,
      `puntas        ${["index", "middle", "ring", "pinky"].map((f) => fixed(m.tips[f])).join(" ")}`,
      `puño    ratio ${fixed(maxLongFinger(m.ratios))} · punta ${fixed(maxLongFinger(m.tips))}`,
      `palma   ${fixed(m.palm)} · arriba ${fixed(m.up)}`,
      `mov.    dx ${fixed(dx)} · dy ${fixed(dy)}`,
    ];
    if (name === "Right") {
      const c = circleMeasure(trackers.circle.samples);
      lines.push(`círculo ${c.turn.toFixed(0).padStart(4)}° · tam. ${fixed(c.size)} · red. ${fixed(c.roundness)}`);
    }
    setText(id, lines.join("\n"));
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
      btnCamera.textContent = "Cámara activa"; // stays disabled, as in P1
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
