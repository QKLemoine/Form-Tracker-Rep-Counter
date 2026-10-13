import { DrawingUtils, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { DEFAULT_EXERCISE, EXERCISES, SIDES, angleToPercent, jointAngle, type Point, type Side } from "./exercises";
import { matchPercent, repDistance, sideFrame, type Frame } from "./formScoring";
import { PoseDetector, type Pose } from "./pose";
import { RepTracker } from "./repTracker";
import { loadGolden, saveGolden, type GoldenRep } from "./storage";

/** A side only counts while the camera can actually see its joints; hidden limbs are guessed and jitter. */
const MIN_VISIBILITY = 0.5;
/** A rep in progress is dropped once its limb has been out of view this long, so it can't finish on stale data. */
const HIDDEN_GRACE_MS = 1000;
/** Time to step back from the phone before a golden rep starts recording. */
const RECORD_COUNTDOWN_MS = 5000;
const SIDE_COLOR: Record<Side, string> = { left: "#6cb6ff", right: "#ffd166" };

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const stage = $<HTMLDivElement>("#stage");
const video = $<HTMLVideoElement>("#video");
const canvas = $<HTMLCanvasElement>("#overlay");
const statusEl = $<HTMLParagraphElement>("#status");
const startButton = $<HTMLButtonElement>("#start");
const flipButton = $<HTMLButtonElement>("#flip");
const recordButton = $<HTMLButtonElement>("#record");
const exerciseSelect = $<HTMLSelectElement>("#exercise");
const sideEls = (side: Side) => ({
  reps: $<HTMLSpanElement>(`#reps-${side}`),
  match: $<HTMLSpanElement>(`#match-${side}`),
  bar: $<HTMLDivElement>(`#bar-${side}`),
  all: document.querySelectorAll<HTMLElement>(`[data-side="${side}"]`),
});
const hud: Record<Side, ReturnType<typeof sideEls>> = { left: sideEls("left"), right: sideEls("right") };

const ctx = canvas.getContext("2d")!;
const drawing = new DrawingUtils(ctx);

interface SideState {
  tracker: RepTracker<Frame>;
  percent: number;
  visible: boolean;
  lastSeen: number;
  /** Distance of the last completed rep from the golden rep, once there is one. */
  lastDistance: number | null;
}
const newSideState = (): SideState => ({ tracker: new RepTracker<Frame>(), percent: 0, visible: false, lastSeen: 0, lastDistance: null });

let exercise = EXERCISES[DEFAULT_EXERCISE];
let sides: Record<Side, SideState> = { left: newSideState(), right: newSideState() };
let golden: GoldenRep | null = loadGolden(exercise.name);
/** Set while recording a golden rep: counting down until `armAt`, then waiting for the first full rep. */
let recording: { armAt: number; armed: boolean } | null = null;
let notice: { text: string; until: number } | null = null;

// Back camera by default: a propped-up phone filming side-on is the main use case.
let facingMode: "environment" | "user" = "environment";
let stream: MediaStream | null = null;
let detectorPromise: Promise<PoseDetector> | null = null;
let detector: PoseDetector | null = null;
let loopRunning = false;

for (const { name, label, experimental } of Object.values(EXERCISES)) {
  exerciseSelect.add(new Option(experimental ? `${label} (experimental)` : label, name, false, name === DEFAULT_EXERCISE));
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function showNotice(text: string): void {
  notice = { text, until: performance.now() + 4000 };
}

async function startCamera(): Promise<void> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera access needs HTTPS. Open this page over https://.", true);
    return;
  }

  stream?.getTracks().forEach((track) => track.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    const denied = err instanceof DOMException && err.name === "NotAllowedError";
    setStatus(denied ? "Camera permission was denied. Allow it in your browser settings." : `Could not start the camera: ${err}`, true);
    return;
  }

  video.srcObject = stream;
  await video.play();
  stage.hidden = false;
  stage.classList.toggle("mirrored", facingMode === "user");
  fitStage();
  startButton.hidden = true;
  flipButton.disabled = false;

  try {
    setStatus("Loading pose model…");
    detectorPromise ??= PoseDetector.create();
    detector = await detectorPromise;
  } catch (err) {
    detectorPromise = null;
    setStatus(`Could not load the pose model: ${err}`, true);
    return;
  }
  recordButton.disabled = false;
  renderHud();

  if (!loopRunning) {
    loopRunning = true;
    video.requestVideoFrameCallback(onFrame);
  }
}

/** Size the stage to the video's aspect ratio within the viewport, so the overlay lines up with the video. */
function fitStage(): void {
  const { videoWidth: w, videoHeight: h } = video;
  if (!w || !h) return;
  canvas.width = w;
  canvas.height = h;
  const maxWidth = Math.min(document.documentElement.clientWidth - 32, 960);
  const maxHeight = window.innerHeight * 0.7;
  const scale = Math.min(maxWidth / w, maxHeight / h);
  stage.style.width = `${Math.round(w * scale)}px`;
  stage.style.height = `${Math.round(h * scale)}px`;
}

function draw(landmarks: NormalizedLandmark[] | null): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  const lineWidth = Math.max(2, canvas.width / 320);
  drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: "#4cc38a", lineWidth });
  // Highlight each limb being measured in its side's colour.
  for (const side of SIDES) {
    if (!sides[side].visible) continue;
    const [a, b, c] = exercise.joints[side];
    drawing.drawConnectors(landmarks, [{ start: a, end: b }, { start: b, end: c }], { color: SIDE_COLOR[side], lineWidth: lineWidth * 2 });
  }
  drawing.drawLandmarks(landmarks, { color: "#e8eaed", radius: lineWidth, lineWidth: 1 });
}

function updateSide(side: Side, pose: Pose | null, now: number): void {
  const state = sides[side];
  const joints = exercise.joints[side];
  state.visible = pose !== null && joints.every((id) => pose.image[id].visibility >= MIN_VISIBILITY);
  if (!pose || !state.visible) {
    if (now - state.lastSeen > HIDDEN_GRACE_MS) state.tracker.abandonRep();
    return;
  }
  state.lastSeen = now;

  // Rep progress uses the 3D joint angle, so it reads the same from the front as from the side.
  const [a, b, c] = joints;
  state.percent = angleToPercent(jointAngle(pose.world[a], pose.world[b], pose.world[c]), exercise.angleRange);

  // Form scoring compares the limb's path in the image. Image landmarks are normalized 0-1 per axis,
  // so convert to pixels or a non-square frame skews distances.
  const toPixels = (id: number): Point => ({ x: pose.image[id].x * canvas.width, y: pose.image[id].y * canvas.height });

  const rep = state.tracker.update(state.percent, sideFrame(toPixels, exercise, side));
  if (!rep) return;
  if (recording?.armed) {
    finishRecording({ side, frames: rep });
  } else if (golden) {
    state.lastDistance = repDistance(golden.frames, rep);
  }
}

function startRecording(): void {
  recording = { armAt: performance.now() + RECORD_COUNTDOWN_MS, armed: false };
  renderHud();
}

function finishRecording(rep: GoldenRep): void {
  golden = rep;
  recording = null;
  // Earlier scores were against the previous golden rep.
  for (const side of SIDES) sides[side].lastDistance = null;
  const stored = saveGolden(exercise.name, rep);
  showNotice(`Golden rep saved from your ${rep.side} side${stored ? "" : " (this visit only: the browser blocked storage)"}`);
}

function renderHud(): void {
  for (const side of SIDES) {
    const state = sides[side];
    const els = hud[side];
    els.reps.textContent = String(Math.floor(state.tracker.count));
    els.bar.style.width = `${state.visible ? state.percent : 0}%`;
    els.match.textContent = state.lastDistance === null ? "–" : `${matchPercent(state.lastDistance)}%`;
    els.match.dataset.distance = state.lastDistance === null ? "" : state.lastDistance.toFixed(3);
    els.all.forEach((el) => el.classList.toggle("hidden-side", !state.visible));
  }
  recordButton.textContent = recording ? "Cancel" : golden ? "Re-record golden rep" : "Record golden rep";
  recordButton.classList.toggle("active", recording !== null);
}

function statusText(tracking: boolean, now: number): string {
  if (recording) {
    return recording.armed
      ? "Recording — do one full rep"
      : `Get in position… ${Math.ceil((recording.armAt - now) / 1000)}`;
  }
  if (notice && now < notice.until) return notice.text;
  if (!tracking) return "No one in view — step into the frame";
  const base = `Tracking (${detector!.delegate})`;
  return golden ? base : `${base} — record a golden rep to score your form`;
}

/** Runs once per new camera frame. */
function onFrame(): void {
  if (detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const now = performance.now();
    if (recording && !recording.armed && now >= recording.armAt) {
      recording.armed = true;
      // Whatever the limbs did while walking into position is not part of the golden rep.
      for (const side of SIDES) sides[side].tracker.abandonRep();
    }

    const pose = detector.detect(video, now);
    for (const side of SIDES) updateSide(side, pose, now);
    draw(pose?.image ?? null);
    renderHud();
    setStatus(statusText(pose !== null, now));
  }
  video.requestVideoFrameCallback(onFrame);
}

startButton.addEventListener("click", () => void startCamera());
flipButton.addEventListener("click", () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  void startCamera();
});
recordButton.addEventListener("click", () => {
  if (recording) {
    recording = null;
    renderHud();
  } else {
    startRecording();
  }
});
exerciseSelect.addEventListener("change", () => {
  exercise = EXERCISES[exerciseSelect.value];
  sides = { left: newSideState(), right: newSideState() };
  golden = loadGolden(exercise.name);
  recording = null;
  renderHud();
});
video.addEventListener("loadedmetadata", fitStage);
window.addEventListener("resize", fitStage);
