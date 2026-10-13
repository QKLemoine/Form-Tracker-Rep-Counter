# Biomechanical Form Tracker & Rep Counter

A computer vision application that utilizes spatial tracking and skeletal landmark detection to analyze workout biomechanics, count repetitions, and evaluate exercise form quality.

## Project Evolution

This project began as an exploration of the MediaPipe framework through basic hand and pose tracking tutorials (preserved in the `/legacy` directory for reference). 

To support advanced spatiotemporal analytics, I refactored the original monolithic scripts into a modular architecture. The application now decouples raw coordinate extraction from state management and scoring logic, allowing for scalable, real-time biomechanical evaluation.

## Repository Structure

- **`/src/core/`**: Contains the pose tracking engine (`PoseEstimationModule`), responsible for reading frames and extracting normalized $(x,y)$ skeletal coordinates. (`HandTrackingModule` is unused and still on the legacy `mp.solutions` API, which mediapipe 1.x removed, so it no longer runs.)
- **`/src/analytics/`**: Houses the mathematical models for evaluating movement quality — DTW-based form scoring (`form_scoring.py`) and the camera-independent rep-counting state machine (`rep_tracker.py`).
- **`/src/exercises.py`**: The exercise registry — each exercise defines its tracked joint triple, angle range, and display label. See [Exercises](#exercises) below.
- **`/src/trainer_app.py`**: The main execution node that bridges the vision pipeline, scoring logic, and UI rendering.
- **`/legacy/`**: Original tutorial scripts and early experimental monolithic code.
- **`/tests/`**: Unit tests for the analytics layer.
- **`/web/`**: The phone/browser version of the app (Vite + TypeScript). See [Phone / Web App](#phone--web-app).
- **`pyproject.toml`**: Packaging config — makes `src` an installable package (`pip install -e .`) and defines the `form-trainer` console script.

## Current Features

- Real-time pose estimation and skeletal landmark extraction via MediaPipe's Pose Landmarker (Tasks API, mediapipe 1.x).
- Biomechanical angle calculation (e.g., elbow and shoulder joint angles).
- State-machine-based repetition counting and set progression tracking.
- **Dynamic Time Warping (DTW) form scoring:** compares live repetitions against a recorded "golden" ideal repetition, calculating a normalized form-error score regardless of rep speed. See [How It Works](#how-it-works-golden-rep-scoring) below.

## How to Run

1. Clone the repository and navigate to the root folder.
2. Create a virtual environment and install the app (editable install, so code changes take effect immediately):
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
   This installs the pinned dependencies and the app itself in editable mode (`requirements.txt` includes `-e .`).

   On Linux, mediapipe also needs the system EGL/GLES libraries. On Ubuntu/Debian: `sudo apt-get install libegl1 libgles2`. (macOS needs nothing extra.)
3. Run it from the repo root, either via the console script or as a module:
   ```bash
   form-trainer
   # or
   python -m src.trainer_app
   ```
   The first run needs an internet connection: it downloads MediaPipe's pose model (~9 MB) to `~/.cache/form-trainer/` (or `$XDG_CACHE_HOME/form-trainer/`). Later runs reuse the cached copy and work offline.
4. Controls:
   - `g` — start/stop recording a "golden" rep (the reference form to score against).
   - `q` — quit.

### CLI flags

All flags are optional; run `form-trainer --help` to see them from the app itself.

| Flag | Default | Description |
| --- | --- | --- |
| `--camera CAMERA` | `0` | Camera device index to use. Ignored if `--video` is given. |
| `--video VIDEO` | *(none)* | Path to a video file to use instead of a live camera. |
| `--exercise {bicep_curl,squat}` | `bicep_curl` | Exercise to track. See [Exercises](#exercises) below. |
| `--angle-range START END` | *(exercise's default)* | Overrides the selected exercise's angle range: the joint angle at rest (0% of the rep) and at the peak (100%). See [Exercises](#exercises). |
| `--golden-rep-path GOLDEN_REP_PATH` | `golden_reps/<exercise>.npy` | Overrides where the golden rep is saved/loaded for the selected exercise. |

Example — run against a recorded clip instead of a webcam:
```bash
form-trainer --video path/to/clip.mp4
```

Example — track squats instead of the default bicep curl:
```bash
form-trainer --exercise squat
```

## Exercises

Exercises are defined in `src/exercises.py` as a small registry: each entry names the three MediaPipe Pose landmarks that form the tracked joint angle, the angle range mapped to 0-100% of a rep, and a display label shown on screen.

Angles are the **interior joint angle in degrees (0–180)**: 180 is a straight limb, smaller is more bent. Because it's unsigned, a joint reads the same whichever side of your body faces the camera. An angle range is written `START END`: `START` is the angle at rest (0% of the rep) and `END` the angle at the peak (100%). Either can be larger — a curl closes the elbow, so its range runs downward. A rep counts when the angle goes from `START` to `END` and back.

- **`bicep_curl`** (default) — tracks the right shoulder/elbow/wrist angle. Range `150 50`: arm extended past 150° is the bottom, curled under 50° is the top. Works filmed from the front or side-on, as long as the right arm is visible.
- **`squat`** — tracks the right hip/knee/ankle angle. **Experimental and uncalibrated**: the `170 90` range (standing → bottom) in the registry is a placeholder, not tuned against real reps, and squats need a side-on camera angle for the hip/knee/ankle triple to read correctly (from the front, knee bend is foreshortened). Use `--angle-range` to override it until the registry default is calibrated.

Each exercise also gets its own golden-rep file (`golden_reps/<exercise>.npy` by default — see below), so recording a golden squat rep won't overwrite a recorded bicep curl rep. That path is relative to wherever you run the app from — e.g. `<repo root>/golden_reps/` when run via `form-trainer` from the repo root.

## How It Works: Golden Rep Scoring

1. Press `g` to start recording a "golden" rep — the reference form you want later reps scored against. Perform one rep, then press `g` again to stop; the recorded frames are locked in as the golden rep and saved to disk at `--golden-rep-path` (`golden_reps/<exercise>.npy` by default).
2. From then on, every completed rep is compared against the golden rep using Dynamic Time Warping (`FormEvaluator` in `src/analytics/form_scoring.py`), and a form score is drawn on screen. Lower is better, but it won't reach 0: landmark tracking jitters from frame to frame, so even the same footage replayed scores around 0.25–0.3. Live reps are only buffered from the moment the movement starts, so press `g` as close to the start and end of the golden rep as you can — extra rest frames in the golden rep inflate every score.
3. On the next run, the app automatically loads the golden rep from `--golden-rep-path` at startup (if the file exists), so you don't need to re-record it every session. If the file is missing or unreadable, the app just starts without a golden rep, as if none had been recorded yet.

## Phone / Web App

`web/` is a browser version that runs on phones (iPhone Safari, Android Chrome) with no app install. Pose tracking runs entirely on the device via MediaPipe's web Pose Landmarker — video is never uploaded anywhere.

**Status:** tracking, rep counting, golden-rep recording and form scoring all work, with the same exercises as the Python app (`web/src/exercises.ts` is the web counterpart of `src/exercises.py`). Pick the exercise from the menu under the video; switching exercise resets the counts.

**Rep progress is measured in 3D.** The desktop app measures the joint angle in the flat image, which closes too early when a limb swings toward the camera (a curl filmed from the front). The web app uses the angle between MediaPipe's estimated 3D joint positions instead, so it reads the same from the front as from the side. That estimate is imperfect, especially for depth: a full curl reads about 50–60° at the top filmed side-on but only about 82° filmed from the front. So the web angle ranges carry extra margin and differ from the desktop ones: bicep curl is `150 90` here against `150 50` on desktop, which means a curl that stops with the forearm level still counts as a full rep.

Unlike the desktop app, which measures the right side only, the web app also tracks **both sides at once**:

- Each side has its own rep count, progress bar and last-rep score, in the same colour as the limb highlighted on the video (left blue, right yellow).
- A side only counts while the camera can see its joints. Filmed side-on, the far limb is dimmed and ignored.
- **Recording a golden rep:** tap **Record golden rep**, use the 5-second countdown to get into position, then do one full rep starting from rest. The first complete rep from either side is saved automatically, in the browser's storage on that device, one per exercise.
- **Scoring:** every later rep is compared with the golden rep and shown as a match percentage. There is one golden rep for both sides — the other side is compared against its mirror image, so a weaker side shows up as a lower score. Scoring uses that side's shoulder, hip and tracked joints, aligned with Dynamic Time Warping so rep speed doesn't matter.
- Record the golden rep from the same camera position you train from: a rep filmed from the front can't be compared with one filmed from the side.

The match percentage scale is a first guess: a replay of the same rep scores about 92–95%, but how low a genuinely bad rep scores has not been calibrated yet (`ZERO_MATCH_DISTANCE` in `web/src/formScoring.ts`).

It's served from GitHub Pages at https://qklemoine.github.io/Form-Tracker-Rep-Counter/ (deployed by `.github/workflows/deploy-web.yml` on every push to `main` that touches `web/`).

To run it locally and open it on your phone:

```bash
cd web
npm install
npm run dev
```

Open the `Network:` URL it prints (e.g. `https://192.168.x.x:5173/`) on a phone on the same Wi-Fi. Phones only allow camera access over HTTPS, so the dev server uses a self-signed certificate: accept the browser's certificate warning once to continue.

## Testing

Install dev dependencies and run the test suite from the repo root:

```bash
pip install -r requirements-dev.txt
pytest
```

The pose-estimation smoke test loads the real model, so the first test run also needs internet to download it (see [How to Run](#how-to-run)).

The web app has its own unit tests for the ported logic:

```bash
cd web
npm install
npm test
```