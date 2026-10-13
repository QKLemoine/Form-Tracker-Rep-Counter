import { DrawingUtils, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { DEFAULT_EXERCISE, EXERCISES, angleToPercent, jointAngle, type Point } from "./exercises";
import { PoseDetector } from "./pose";
import { RepTracker } from "./repTracker";

const stage = document.querySelector<HTMLDivElement>("#stage")!;
const video = document.querySelector<HTMLVideoElement>("#video")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const flipButton = document.querySelector<HTMLButtonElement>("#flip")!;
const exerciseSelect = document.querySelector<HTMLSelectElement>("#exercise")!;
const repsEl = document.querySelector<HTMLSpanElement>("#reps")!;
const progressFill = document.querySelector<HTMLDivElement>("#progress-fill")!;

const ctx = canvas.getContext("2d")!;
const drawing = new DrawingUtils(ctx);

let exercise = EXERCISES[DEFAULT_EXERCISE];
let tracker = new RepTracker();

for (const { name, label, experimental } of Object.values(EXERCISES)) {
  exerciseSelect.add(new Option(experimental ? `${label} (experimental)` : label, name, false, name === DEFAULT_EXERCISE));
}

// Back camera by default: a propped-up phone filming side-on is the main use case.
let facingMode: "environment" | "user" = "environment";
let stream: MediaStream | null = null;
let detectorPromise: Promise<PoseDetector> | null = null;
let detector: PoseDetector | null = null;
let lastVideoTime = -1;
let loopRunning = false;

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
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

  if (!loopRunning) {
    loopRunning = true;
    requestAnimationFrame(loop);
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
  // Highlight the limb the selected exercise is measuring.
  const [a, b, c] = exercise.joints;
  drawing.drawConnectors(landmarks, [{ start: a, end: b }, { start: b, end: c }], { color: "#ffd166", lineWidth: lineWidth * 2 });
  drawing.drawLandmarks(landmarks, { color: "#e8eaed", radius: lineWidth, lineWidth: 1 });
}

function updateReps(landmarks: NormalizedLandmark[]): void {
  // Landmarks are normalized 0-1 per axis; angles must be measured in pixels or a non-square frame skews them.
  const toPixels = (i: number): Point => ({ x: landmarks[i].x * canvas.width, y: landmarks[i].y * canvas.height });
  const [a, b, c] = exercise.joints;
  const percent = angleToPercent(jointAngle(toPixels(a), toPixels(b), toPixels(c)), exercise.angleRange);
  tracker.update(percent);
  renderHud(percent);
}

function renderHud(percent: number): void {
  repsEl.textContent = String(Math.floor(tracker.count));
  progressFill.style.width = `${percent}%`;
}

function loop(): void {
  if (detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const landmarks = detector.detect(video, performance.now());
    draw(landmarks);
    if (landmarks) updateReps(landmarks);
    setStatus(landmarks ? `Tracking (${detector.delegate})` : "No one in view — step into the frame");
  }
  requestAnimationFrame(loop);
}

startButton.addEventListener("click", () => void startCamera());
flipButton.addEventListener("click", () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  void startCamera();
});
exerciseSelect.addEventListener("change", () => {
  exercise = EXERCISES[exerciseSelect.value];
  tracker = new RepTracker();
  renderHud(0);
});
video.addEventListener("loadedmetadata", fitStage);
window.addEventListener("resize", fitStage);
