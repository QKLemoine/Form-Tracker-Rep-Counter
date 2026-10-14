// The page: camera, drawing and controls. All tracking decisions live in tracking.ts.

import { DrawingUtils, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { DEFAULT_EXERCISE, EXERCISES, SIDES, calibrateRange, type AngleRange, type Side } from "./exercises";
import { matchPercent, repDistance, type Frame } from "./formScoring";
import { PoseDetector, type Pose } from "./pose";
import { RECORDED_LANDMARKS, recordFrame, type LandmarkRecording, type RecordedFrame } from "./recording";
import { loadGolden, saveGolden, type GoldenRep } from "./storage";
import { MotionTracker, type SideSnapshot } from "./tracking";

/** Time to step back from the phone before recording or calibrating starts. */
const COUNTDOWN_MS = 5000;
/** How long calibration watches the reps. */
const CALIBRATION_MS = 10000;
/** Landmark recordings stop by themselves after this long. */
const MAX_LANDMARK_RECORDING_MS = 60000;
const SIDE_COLOR: Record<Side, string> = { left: "#6cb6ff", right: "#ffd166" };

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const stage = $<HTMLDivElement>("#stage");
const video = $<HTMLVideoElement>("#video");
const canvas = $<HTMLCanvasElement>("#overlay");
const statusEl = $<HTMLParagraphElement>("#status");
const startButton = $<HTMLButtonElement>("#start");
const flipButton = $<HTMLButtonElement>("#flip");
const calibrateButton = $<HTMLButtonElement>("#calibrate");
const recordButton = $<HTMLButtonElement>("#record");
const exerciseSelect = $<HTMLSelectElement>("#exercise");
const debugToggle = $<HTMLButtonElement>("#debug-toggle");
const debugPanel = $<HTMLElement>("#debug");
const debugText = $<HTMLPreElement>("#debug-text");
const landmarksButton = $<HTMLButtonElement>("#record-landmarks");
const resetCalibrationButton = $<HTMLButtonElement>("#reset-calibration");
const sideEls = (side: Side) => ({
  reps: $<HTMLSpanElement>(`#reps-${side}`),
  match: $<HTMLSpanElement>(`#match-${side}`),
  note: $<HTMLDivElement>(`#note-${side}`),
  bar: $<HTMLDivElement>(`#bar-${side}`),
  all: document.querySelectorAll<HTMLElement>(`[data-side="${side}"]`),
});
const hud: Record<Side, ReturnType<typeof sideEls>> = { left: sideEls("left"), right: sideEls("right") };

const ctx = canvas.getContext("2d")!;
const drawing = new DrawingUtils(ctx);

/**
 * A hands-free step in progress: counting down until `armAt`, then either waiting for the first
 * full rep (golden) or sampling each side's angle until `endAt` (calibrate).
 */
type Session =
  | { kind: "golden"; armAt: number; armed: boolean }
  | { kind: "calibrate"; armAt: number; endAt: number; armed: boolean; angles: Record<Side, number[]> };

let exercise = EXERCISES[DEFAULT_EXERCISE];
let tracker = new MotionTracker(exercise);
let snapshots: Record<Side, SideSnapshot> | null = null;
/** Distance of each side's last completed rep from the golden rep, once there is one. */
let lastDistance: Record<Side, number | null> = { left: null, right: null };
let golden: GoldenRep | null = loadGolden(exercise.name);
let session: Session | null = null;
let notice: { text: string; until: number } | null = null;
let landmarkRecording: { startedAt: number; frames: RecordedFrame[] } | null = null;
let frameIntervalMs = 0;
let lastFrameAt = 0;

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

function showNotice(text: string, ms = 4000): void {
  notice = { text, until: performance.now() + ms };
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
  for (const button of [calibrateButton, recordButton, landmarksButton, resetCalibrationButton]) button.disabled = false;
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
    if (!snapshots?.[side].visible) continue;
    const [a, b, c] = exercise.joints[side];
    drawing.drawConnectors(landmarks, [{ start: a, end: b }, { start: b, end: c }], { color: SIDE_COLOR[side], lineWidth: lineWidth * 2 });
  }
  drawing.drawLandmarks(landmarks, { color: "#e8eaed", radius: lineWidth, lineWidth: 1 });
}

function startSession(kind: Session["kind"]): void {
  const armAt = performance.now() + COUNTDOWN_MS;
  session =
    kind === "golden"
      ? { kind, armAt, armed: false }
      : { kind, armAt, endAt: armAt + CALIBRATION_MS, armed: false, angles: { left: [], right: [] } };
  renderHud();
}

function finishGolden(side: Side, frames: Frame[]): void {
  golden = { side, frames };
  session = null;
  // Earlier scores were against the previous golden rep.
  lastDistance = { left: null, right: null };
  const stored = saveGolden(exercise.name, golden);
  showNotice(`Golden rep saved from your ${side} side${stored ? "" : " (this visit only: the browser blocked storage)"}`);
}

const describeRange = ([rest, top]: AngleRange) => `${Math.round(rest)}°→${Math.round(top)}°`;

function finishCalibration(angles: Record<Side, number[]>): void {
  session = null;
  const ranges = { left: calibrateRange(exercise.angleRange, angles.left), right: calibrateRange(exercise.angleRange, angles.right) };
  if (!ranges.left && !ranges.right) {
    showNotice("Calibration saw no full reps, so nothing changed. Make sure your arms are in view and try again.", 8000);
    return;
  }
  // A side with no full rep in view goes back to the default rather than keeping a range from another camera position.
  for (const side of SIDES) tracker.setRange(side, ranges[side]);
  const parts = SIDES.map((side) => `${side} ${ranges[side] ? describeRange(ranges[side]) : "no full rep seen (default range)"}`);
  showNotice(`Calibrated: ${parts.join(", ")}`, 8000);
}

function resetCalibration(): void {
  for (const side of SIDES) tracker.setRange(side, null);
}

function handleSnapshots(snaps: Record<Side, SideSnapshot>, now: number): void {
  for (const side of SIDES) {
    const snap = snaps[side];
    if (session?.kind === "calibrate" && session.armed && snap.updated && snap.angle !== null) {
      session.angles[side].push(snap.angle);
    }
    if (!snap.completedRep) continue;
    if (session?.kind === "golden" && session.armed) {
      finishGolden(side, snap.completedRep);
    } else if (golden) {
      lastDistance[side] = repDistance(golden.frames, snap.completedRep);
    }
  }
  if (session?.kind === "calibrate" && session.armed && now >= session.endAt) finishCalibration(session.angles);
}

function renderHud(): void {
  for (const side of SIDES) {
    const snap = snapshots?.[side];
    const els = hud[side];
    const distance = lastDistance[side];
    els.reps.textContent = String(snap?.count ?? 0);
    // A hidden side keeps its last value instead of dropping to zero.
    els.bar.style.width = `${snap?.percent ?? 0}%`;
    els.bar.classList.toggle("peaked", snap?.phase === "peaked");
    els.match.textContent = distance === null ? "–" : `${matchPercent(distance)}%`;
    els.match.dataset.distance = distance === null ? "" : distance.toFixed(3);
    els.note.textContent = snap && !snap.visible ? "not visible" : "";
    els.all.forEach((el) => el.classList.toggle("hidden-side", !snap?.visible));
  }
  calibrateButton.textContent = session?.kind === "calibrate" ? "Cancel" : "Calibrate";
  calibrateButton.classList.toggle("active", session?.kind === "calibrate");
  recordButton.textContent = session?.kind === "golden" ? "Cancel" : golden ? "Re-record golden rep" : "Record golden rep";
  recordButton.classList.toggle("active", session?.kind === "golden");
  if (detector) {
    calibrateButton.disabled = session?.kind === "golden";
    recordButton.disabled = session?.kind === "calibrate";
  }
  landmarksButton.textContent = landmarkRecording ? "Stop and save landmarks" : "Record landmarks";
  landmarksButton.classList.toggle("active", landmarkRecording !== null);
}

function statusText(tracking: boolean, now: number): string {
  const seconds = (until: number) => Math.max(1, Math.ceil((until - now) / 1000));
  if (session && !session.armed) return `Get in position… ${seconds(session.armAt)}`;
  if (session?.kind === "golden") return "Recording — do one full rep";
  if (session?.kind === "calibrate") return `Calibrating — slow full reps, arms straight to fully curled… ${seconds(session.endAt)}`;
  if (notice && now < notice.until) return notice.text;
  if (!tracking) return "No one in view — step into the frame";
  const base = `Tracking (${detector!.delegate})`;
  if (!SIDES.some((side) => snapshots?.[side].calibrated)) return `${base} — tap Calibrate so each side is measured against its own range`;
  return golden ? base : `${base} — record a golden rep to score your form`;
}

function renderDebug(): void {
  if (debugPanel.hidden) return;
  const n = (value: number | null | undefined, places = 0) => (value === null || value === undefined ? "–" : value.toFixed(places));
  const lines = [
    `${frameIntervalMs ? (1000 / frameIntervalMs).toFixed(0) : "–"} fps   ${detector?.delegate ?? "–"}   video ${video.videoWidth}x${video.videoHeight}   ${facingMode === "user" ? "front" : "back"} camera`,
  ];
  for (const side of SIDES) {
    const snap = snapshots?.[side];
    if (!snap) continue;
    lines.push(
      "",
      `${side.toUpperCase().padEnd(5)} ${snap.visible ? "visible" : "NOT VISIBLE"}   ${snap.phase}   reps ${snap.count}`,
      `  joint visibility  ${snap.jointVisibility?.map((v) => v.toFixed(2)).join("  ") ?? "–"}`,
      `  angle  3D raw ${n(snap.rawAngle, 1)}   smoothed ${n(snap.angle, 1)}   2D ${n(snap.angle2d, 1)}`,
      `  range  ${describeRange(snap.range)} ${snap.calibrated ? "(calibrated)" : "(default)"}   bar ${n(snap.percent)}%`,
    );
  }
  debugText.textContent = lines.join("\n");
}

function saveLandmarkRecording(): void {
  if (!landmarkRecording) return;
  const recording: LandmarkRecording & Record<string, unknown> = {
    source: "form-trainer web app",
    mirrored: false,
    width: canvas.width,
    height: canvas.height,
    landmarkIds: RECORDED_LANDMARKS,
    exercise: exercise.name,
    camera: facingMode === "user" ? "front" : "back",
    delegate: detector?.delegate,
    frames: landmarkRecording.frames,
  };
  landmarkRecording = null;
  const url = URL.createObjectURL(new Blob([JSON.stringify(recording)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `landmarks-${exercise.name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  showNotice(`Saved ${recording.frames.length} frames of landmarks`);
}

/** Runs once per new camera frame. */
function onFrame(): void {
  if (detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const now = performance.now();
    if (lastFrameAt) frameIntervalMs = frameIntervalMs ? frameIntervalMs * 0.9 + (now - lastFrameAt) * 0.1 : now - lastFrameAt;
    lastFrameAt = now;

    if (session && !session.armed && now >= session.armAt) {
      session.armed = true;
      // Whatever the limbs did while walking into position is not part of the golden rep.
      if (session.kind === "golden") tracker.abandonReps();
    }

    const pose: Pose | null = detector.detect(video, now);
    snapshots = tracker.update(pose, now, { width: canvas.width, height: canvas.height });
    handleSnapshots(snapshots, now);

    if (landmarkRecording) {
      landmarkRecording.frames.push(recordFrame(pose, now - landmarkRecording.startedAt));
      if (now - landmarkRecording.startedAt >= MAX_LANDMARK_RECORDING_MS) saveLandmarkRecording();
    }

    draw(pose?.image ?? null);
    renderHud();
    renderDebug();
    setStatus(statusText(pose !== null, now));
  }
  video.requestVideoFrameCallback(onFrame);
}

function toggleSession(kind: Session["kind"]): void {
  if (session?.kind === kind) {
    session = null;
    renderHud();
  } else {
    startSession(kind);
  }
}

startButton.addEventListener("click", () => void startCamera());
flipButton.addEventListener("click", () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  // The other camera sees the body from a different position, so its ranges don't carry over.
  resetCalibration();
  void startCamera();
});
calibrateButton.addEventListener("click", () => toggleSession("calibrate"));
recordButton.addEventListener("click", () => toggleSession("golden"));
resetCalibrationButton.addEventListener("click", () => {
  resetCalibration();
  showNotice("Calibration reset to the default ranges");
});
landmarksButton.addEventListener("click", () => {
  if (landmarkRecording) saveLandmarkRecording();
  else landmarkRecording = { startedAt: performance.now(), frames: [] };
  renderHud();
});
debugToggle.addEventListener("click", () => {
  debugPanel.hidden = !debugPanel.hidden;
  debugToggle.setAttribute("aria-expanded", String(!debugPanel.hidden));
  renderDebug();
});
exerciseSelect.addEventListener("change", () => {
  exercise = EXERCISES[exerciseSelect.value];
  tracker = new MotionTracker(exercise);
  snapshots = null;
  lastDistance = { left: null, right: null };
  golden = loadGolden(exercise.name);
  session = null;
  renderHud();
});
video.addEventListener("loadedmetadata", fitStage);
window.addEventListener("resize", fitStage);
