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
 * How far each long fingertip is from the base of its finger (MCP), relative to the hand size.
 * It tells a real fist apart from a half-closed hand: in a tight fist the tip touches the palm
 * next to the knuckle; in a half-closed hand (fingers curled like a claw) it stays far.
 * Approximate values: tight fist ≈ 0.2–0.4 · half-closed ≈ 0.5–0.8 · extended ≈ 0.8–1.0.
 * @param {Landmarks} points The 21 points of one hand (worldLandmarks recommended).
 * @returns {{index: number, middle: number, ring: number, pinky: number}} One value per long
 *   finger: dist(tip, MCP) / handSize.
 */
export function tipToBase(points) {
  const size = handSize(points);
  const ratio = (tip, mcp) => distance(points[tip], points[mcp]) / size;
  return {
    index: ratio(LM.INDEX_TIP, LM.INDEX_MCP),
    middle: ratio(LM.MIDDLE_TIP, LM.MIDDLE_MCP),
    ring: ratio(LM.RING_TIP, LM.RING_MCP),
    pinky: ratio(LM.PINKY_TIP, LM.PINKY_MCP),
  };
}

/**
 * Largest value among the four long fingers (the most open one).
 * @param {{index: number, middle: number, ring: number, pinky: number}} values Per-finger values,
 *   e.g. from fingerRatios() or tipToBase().
 * @returns {number} max(index, middle, ring, pinky).
 */
export function maxLongFinger(values) {
  return Math.max(values.index, values.middle, values.ring, values.pinky);
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

// ---------- Trajectories: circles ----------

/**
 * Describes how circular a trajectory is. Feed it the samples of a MotionTracker that follows
 * the index fingertip. Points closer than `minStep` hand sizes to the previous kept point are
 * skipped, so the jitter of a still finger does not add up as turning.
 * @param {{x: number, y: number, size: number}[]} samples MotionTracker samples (x already
 *   scaled by the aspect ratio, size = hand size in the image).
 * @param {number} [minStep=0.1] Minimum distance between kept points, in hand sizes.
 * @returns {{turn: number, size: number, roundness: number}} turn: total turning of the path in
 *   degrees (absolute value, so both directions count; a full circle ≈ 360); size: the smaller
 *   side of the path's bounding box, in hand sizes (a straight line has size ≈ 0); roundness:
 *   smaller side / larger side of the bounding box (1 for a circle, close to 0 for a line).
 */
export function circleMeasure(samples, minStep = 0.1) {
  const empty = { turn: 0, size: 0, roundness: 0 };
  if (samples.length < 3) return empty;
  const handSize = samples.reduce((sum, s) => sum + s.size, 0) / samples.length || 1;

  // Keep only points that moved enough since the last kept one
  const points = [samples[0]];
  for (const s of samples) {
    const last = points[points.length - 1];
    if (Math.hypot(s.x - last.x, s.y - last.y) >= minStep * handSize) points.push(s);
  }
  if (points.length < 4) return empty;

  // Sum of the signed angles between consecutive movement vectors
  let turn = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x;
    const by = points[i + 1].y - points[i].y;
    turn += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const small = Math.min(width, height);
  const large = Math.max(width, height);
  return {
    turn: Math.abs((turn * 180) / Math.PI),
    size: small / handSize,
    roundness: large === 0 ? 0 : small / large,
  };
}

// ---------- Static gestures: hold to trigger ----------

/**
 * Turns a per-frame "pose detected?" signal into a single trigger. The pose has to be held for
 * `holdMs`; then it fires ONCE and does not fire again until the pose is released. Short gaps
 * of up to `graceMs` without the pose do not restart the hold.
 *
 * With holdMs = 0 and graceMs = 0 it fires on the first frame of the pose (the naive version).
 */
export class HoldGesture {
  constructor() {
    this.reset();
  }

  /**
   * Forgets any hold in progress (e.g. when the remote goes idle).
   * @returns {void}
   */
  reset() {
    this.start = null; // when the current hold started (null = not holding)
    this.lastSeen = -Infinity; // last time the pose was detected
    this.needsRelease = false; // already fired: wait until the pose is released
  }

  /**
   * Whether a hold is in progress.
   * @returns {boolean} true between the first frame of the pose and the trigger.
   */
  get holding() {
    return this.start !== null;
  }

  /**
   * Feeds one frame.
   * @param {number} now Current time in milliseconds (performance.now()).
   * @param {boolean} detected Whether the pose is detected in this frame.
   * @param {object} [options]
   * @param {number} [options.holdMs=0] How long the pose must be held before firing.
   * @param {number} [options.graceMs=0] How long the pose may be missing without restarting.
   * @returns {{fired: boolean, progress: number}} fired is true only on the frame that triggers;
   *   progress goes from 0 to 1 while holding.
   */
  update(now, detected, { holdMs = 0, graceMs = 0 } = {}) {
    if (detected) {
      this.lastSeen = now;
      if (this.needsRelease) return { fired: false, progress: 0 };
      this.start ??= now;
      const progress = holdMs > 0 ? Math.min(1, (now - this.start) / holdMs) : 1;
      if (progress >= 1) {
        this.start = null;
        this.needsRelease = true;
        return { fired: true, progress: 1 };
      }
      return { fired: false, progress };
    }
    if (now - this.lastSeen > graceMs) {
      this.start = null;
      this.needsRelease = false;
    }
    const progress = this.holding && holdMs > 0 ? Math.min(1, (now - this.start) / holdMs) : 0;
    return { fired: false, progress };
  }
}

// ---------- Dynamic gestures: direction-aware waiting ----------

/**
 * Decides whether a stroke (a movement in one direction, e.g. a swipe or a volume step) may fire,
 * given the previous one. Another stroke in the SAME direction only has to wait `sameDirMs`, so
 * strokes can be chained; one in the OPPOSITE direction has to wait `reverseMs`, so the hand
 * coming back to repeat the gesture does not fire the opposite action.
 */
export class StrokeGate {
  constructor() {
    this.reset();
  }

  /**
   * Forgets the previous stroke.
   * @returns {void}
   */
  reset() {
    this.lastTime = -Infinity; // when the last stroke fired
    this.lastDir = 0; // its direction: +1 or −1
  }

  /**
   * Whether a stroke in `dir` may fire now.
   * @param {number} now Current time in milliseconds (performance.now()).
   * @param {number} dir Direction of the new stroke: +1 or −1.
   * @param {object} [options]
   * @param {number} [options.sameDirMs=0] Wait after a stroke in the same direction.
   * @param {number} [options.reverseMs=0] Wait after a stroke in the opposite direction.
   * @returns {boolean} true if enough time has passed since the last stroke.
   */
  allows(now, dir, { sameDirMs = 0, reverseMs = 0 } = {}) {
    const wait = dir === this.lastDir ? sameDirMs : reverseMs;
    return now - this.lastTime >= wait;
  }

  /**
   * Remembers a stroke that has just fired.
   * @param {number} now Current time in milliseconds (performance.now()).
   * @param {number} dir Its direction: +1 or −1.
   * @returns {void}
   */
  record(now, dir) {
    this.lastTime = now;
    this.lastDir = dir;
  }
}

// ---------- All together ----------

/**
 * Computes every measure of one hand at once (handy for the calibration panel and to avoid
 * repeating work in each gesture).
 * @param {{landmarks: Landmarks, world: Landmarks}} hand A hand as returned by findHand().
 * @param {HandName} handName Which hand it is.
 * @param {typeof THRESHOLDS} [thresholds=THRESHOLDS] Thresholds for the finger states.
 * @returns {{size: number, ratios: FingerRatios, tips: object, fingers: FingerStates,
 *   longFingers: number, palm: number, up: number}} Hand size (m), finger ratios, tip-to-base
 *   distances, finger states, number of extended long fingers, palm towards camera (−1…+1) and
 *   fingers up (−1…+1).
 */
export function measureHand(hand, handName, thresholds = THRESHOLDS) {
  const ratios = fingerRatios(hand.world);
  const fingers = fingersExtended(ratios, thresholds);
  return {
    size: handSize(hand.world),
    ratios,
    tips: tipToBase(hand.world),
    fingers,
    longFingers: countLongFingers(fingers),
    palm: palmFacingCamera(hand.world, handName),
    up: fingersUp(hand.world),
  };
}
