/**
 * P2 · Reusable helpers to recognise gestures from the 21 hand landmarks.
 *
 * They do not touch the page: they take points and return numbers, so they can be tested
 * without a camera.
 *
 * MediaPipe conventions (UNMIRRORED image, the one the model receives):
 *   x grows to the right of the image, y grows DOWNWARDS, smaller z = closer to the camera.
 *   The page view is mirrored with CSS; the data is not.
 *
 * @typedef {{x: number, y: number, z?: number}} Point  A landmark or a 3D vector.
 * @typedef {Point[]} Landmarks  The 21 points of one hand (landmarks or worldLandmarks).
 * @typedef {"Left" | "Right"} HandName  Handedness as reported by MediaPipe (the person's hand).
 * @typedef {{thumb: number, index: number, middle: number, ring: number, pinky: number}} FingerRatios
 * @typedef {{thumb: boolean, index: boolean, middle: boolean, ring: boolean, pinky: boolean}} FingerStates
 */

/** Landmark indices (see the hand diagram in Tutorial 4). */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

/** Finger names, from thumb to pinky. */
export const FINGER_NAMES = ["thumb", "index", "middle", "ring", "pinky"];

/**
 * Starting thresholds. CALIBRATE them with the measures panel and report the final values
 * in the written report.
 */
export const THRESHOLDS = {
  fingerExtended: 1.1, // ratio > threshold → finger extended (index, middle, ring, pinky)
  thumbExtended: 1.1, // thumb ratio > threshold → thumb extended
};

// ---------- Basic geometry ----------

/**
 * Vector from b to a.
 * @param {Point} a End point.
 * @param {Point} b Start point.
 * @returns {Point} a − b (a missing z counts as 0).
 */
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
}

/**
 * Cross product of two 3D vectors.
 * @param {Point} a First vector.
 * @param {Point} b Second vector.
 * @returns {Point} a × b, perpendicular to both.
 */
export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Length of a vector.
 * @param {Point} v Vector.
 * @returns {number} Euclidean norm (a missing z counts as 0).
 */
export function norm(v) {
  return Math.hypot(v.x, v.y, v.z ?? 0);
}

/**
 * Unit vector with the same direction.
 * @param {Point} v Vector.
 * @returns {Point} v / |v|, or the zero vector if v has length 0.
 */
export function normalize(v) {
  const n = norm(v);
  return n === 0 ? { x: 0, y: 0, z: 0 } : { x: v.x / n, y: v.y / n, z: (v.z ?? 0) / n };
}

/**
 * 3D distance between two points.
 * @param {Point} a First point.
 * @param {Point} b Second point.
 * @returns {number} Distance, in the units of the points (metres for worldLandmarks).
 */
export function distance(a, b) {
  return norm(sub(a, b));
}

/**
 * Distance using only x and y, ignoring z (the least reliable coordinate).
 * @param {Point} a First point.
 * @param {Point} b Second point.
 * @returns {number} 2D distance.
 */
export function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------- Hand size ----------

/**
 * Reference hand size: wrist (0) → middle finger MCP (9).
 * Divide any distance by this value so it does not depend on how far the person is.
 * @param {Landmarks} points The 21 points of one hand.
 * @returns {number} Hand size, in the units of the points.
 */
export function handSize(points) {
  return distance(points[LM.WRIST], points[LM.MIDDLE_MCP]);
}

// ---------- Extended or bent fingers ----------

/**
 * Extension ratio of each finger. Use worldLandmarks.
 * - Index, middle, ring, pinky: dist(wrist, tip) / dist(wrist, PIP).
 *   Extended ≈ 1.3–1.5 · bent (fist) < 1.
 * - Thumb: dist(tip 4, pinky MCP 17) / dist(IP 3, pinky MCP 17).
 *   The wrist does not work for the thumb (tip and IP are at similar distances); in a fist the
 *   tip crosses the palm towards the pinky and ends up CLOSER than the IP. Least reliable finger.
 * @param {Landmarks} points The 21 points of one hand (worldLandmarks recommended).
 * @returns {FingerRatios} One ratio per finger: > 1 extended, < 1 bent.
 */
export function fingerRatios(points) {
  const wrist = points[LM.WRIST];
  const pinkyMcp = points[LM.PINKY_MCP];
  const ratio = (tip, pip) => distance(wrist, points[tip]) / distance(wrist, points[pip]);
  return {
    thumb: distance(points[LM.THUMB_TIP], pinkyMcp) / distance(points[LM.THUMB_IP], pinkyMcp),
    index: ratio(LM.INDEX_TIP, LM.INDEX_PIP),
    middle: ratio(LM.MIDDLE_TIP, LM.MIDDLE_PIP),
    ring: ratio(LM.RING_TIP, LM.RING_PIP),
    pinky: ratio(LM.PINKY_TIP, LM.PINKY_PIP),
  };
}

/**
 * Turns finger ratios into extended / bent states.
 * @param {FingerRatios} ratios Output of fingerRatios().
 * @param {typeof THRESHOLDS} [thresholds=THRESHOLDS] Thresholds to compare against.
 * @returns {FingerStates} true = extended, false = bent, per finger.
 */
export function fingersExtended(ratios, thresholds = THRESHOLDS) {
  const states = {};
  for (const name of FINGER_NAMES) {
    const limit = name === "thumb" ? thresholds.thumbExtended : thresholds.fingerExtended;
    states[name] = ratios[name] > limit;
  }
  return states;
}

/**
 * Counts how many of the four long fingers (not the thumb) are extended.
 * @param {FingerStates} states Output of fingersExtended().
 * @returns {number} 0 (fist) to 4 (open hand).
 */
export function countLongFingers(states) {
  return ["index", "middle", "ring", "pinky"].filter((name) => states[name]).length;
}

/**
 * Checks the finger states against an expected pattern. Fingers not in the pattern are ignored.
 * @example matchesPattern(states, { index: true, middle: false, ring: false, pinky: false })
 * @param {FingerStates} states Output of fingersExtended().
 * @param {Partial<FingerStates>} pattern Expected state for some fingers.
 * @returns {boolean} true if every finger in the pattern matches.
 */
export function matchesPattern(states, pattern) {
  return Object.entries(pattern).every(([name, expected]) => states[name] === expected);
}

// ---------- Hand orientation ----------

/**
 * Palm normal: cross product (wrist → index MCP) × (wrist → pinky MCP). Use worldLandmarks.
 * @param {Landmarks} world The 21 world points of one hand.
 * @returns {Point} Unit vector perpendicular to the palm (its sign depends on the hand).
 */
export function palmNormal(world) {
  const wrist = world[LM.WRIST];
  return normalize(cross(sub(world[LM.INDEX_MCP], wrist), sub(world[LM.PINKY_MCP], wrist)));
}

/**
 * How much the palm faces the camera, with the sign already corrected for each hand.
 * With the RIGHT hand facing the camera, the index is on the right of the image and the pinky on
 * the left, so the normal has z < 0 (towards the camera); for the left hand it is reversed.
 * CHECK IT in the measures panel before choosing a threshold.
 * @param {Landmarks} world The 21 world points of one hand.
 * @param {HandName} handName Which hand the points belong to.
 * @returns {number} +1 palm towards the camera, 0 edge-on, −1 back of the hand towards the camera.
 */
export function palmFacingCamera(world, handName) {
  const n = palmNormal(world);
  return handName === "Right" ? -n.z : n.z;
}

/**
 * How much the fingers point upwards, from the direction wrist → middle MCP in x and y
 * (y grows downwards, hence the minus sign).
 * @param {Landmarks} points The 21 points of one hand.
 * @returns {number} +1 straight up, 0 horizontal, −1 straight down.
 */
export function fingersUp(points) {
  const v = sub(points[LM.MIDDLE_MCP], points[LM.WRIST]);
  const length = Math.hypot(v.x, v.y);
  return length === 0 ? 0 : -v.y / length;
}

// ---------- Motion (dynamic gestures) ----------

/**
 * Keeps the position of one landmark (the wrist by default) over the last `windowMs`
 * milliseconds and measures its displacement. It works with time, not frames, so it behaves
 * the same at 15 or 30 fps. Feed it normalised image landmarks.
 *
 * Displacements are returned:
 * - "on screen": right and up are positive AS SEEN IN THE MIRRORED page (in the unmirrored
 *   data, moving towards the person's right decreases x; this is already corrected here).
 * - relative to the hand size in the image: 1.0 = the hand moved its own size, so the same
 *   threshold works near and far from the camera.
 */
export class MotionTracker {
  /**
   * @param {object} [options]
   * @param {number} [options.windowMs=500] Length of the time window, in milliseconds.
   * @param {number} [options.point=LM.WRIST] Index of the landmark to track.
   * @param {number} [options.aspect=4/3] Video width / height (x and y are normalised by
   *   different sizes, so they must be put on the same scale).
   */
  constructor({ windowMs = 500, point = LM.WRIST, aspect = 4 / 3 } = {}) {
    this.windowMs = windowMs;
    this.point = point;
    this.aspect = aspect;
    this.samples = [];
  }

  /**
   * Adds this frame's position and drops samples older than the window.
   * @param {number} t Timestamp in milliseconds (performance.now()).
   * @param {Landmarks} landmarks The 21 normalised image points of the hand.
   * @returns {void}
   */
  push(t, landmarks) {
    const p = landmarks[this.point];
    const size = Math.hypot(
      (landmarks[LM.MIDDLE_MCP].x - landmarks[LM.WRIST].x) * this.aspect,
      landmarks[LM.MIDDLE_MCP].y - landmarks[LM.WRIST].y,
    );
    this.samples.push({ t, x: p.x * this.aspect, y: p.y, size });
    while (this.samples.length > 0 && t - this.samples[0].t > this.windowMs) this.samples.shift();
  }

  /**
   * Empties the window. Call it when the hand is lost or after an action, so movements
   * are not mixed.
   * @returns {void}
   */
  clear() {
    this.samples.length = 0;
  }

  /**
   * Displacement between the oldest and the newest sample in the window.
   * @returns {{dx: number, dy: number, dt: number}} dx (right +) and dy (up +) on screen, in hand
   *   sizes; dt in milliseconds. All zero with fewer than two samples.
   */
  displacement() {
    if (this.samples.length < 2) return { dx: 0, dy: 0, dt: 0 };
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const size = this.samples.reduce((sum, s) => sum + s.size, 0) / this.samples.length || 1;
    return {
      dx: -(last.x - first.x) / size, // mirror: right on screen = decreasing x in the data
      dy: -(last.y - first.y) / size, // up is positive
      dt: last.t - first.t,
    };
  }

  /**
   * Average velocity over the window.
   * @returns {{vx: number, vy: number}} Velocity on screen, in hand sizes per second.
   */
  velocity() {
    const { dx, dy, dt } = this.displacement();
    return dt === 0 ? { vx: 0, vy: 0 } : { vx: (dx * 1000) / dt, vy: (dy * 1000) / dt };
  }
}

// ---------- All together ----------

/**
 * Computes every measure of one hand at once (handy for the calibration panel and to avoid
 * repeating work in each gesture).
 * @param {{landmarks: Landmarks, world: Landmarks}} hand A hand as returned by findHand().
 * @param {HandName} handName Which hand it is.
 * @param {typeof THRESHOLDS} [thresholds=THRESHOLDS] Thresholds for the finger states.
 * @returns {{size: number, ratios: FingerRatios, fingers: FingerStates, longFingers: number,
 *   palm: number, up: number}} Hand size (m), finger ratios and states, number of extended long
 *   fingers, palm towards camera (−1…+1) and fingers up (−1…+1).
 */
export function measureHand(hand, handName, thresholds = THRESHOLDS) {
  const ratios = fingerRatios(hand.world);
  const fingers = fingersExtended(ratios, thresholds);
  return {
    size: handSize(hand.world),
    ratios,
    fingers,
    longFingers: countLongFingers(fingers),
    palm: palmFacingCamera(hand.world, handName),
    up: fingersUp(hand.world),
  };
}
