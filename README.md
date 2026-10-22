# Biomechanical Form Tracker & Rep Counter

[![XERJ Corpus Hub contributor](https://hub.xerj.org/contributors/QKLemoine/badge.svg)](https://hub.xerj.org/contributors/QKLemoine)

A computer vision application that utilizes spatial tracking and skeletal landmark detection to analyze workout biomechanics, count repetitions, and evaluate exercise form quality.

## Project Evolution

This project began as an exploration of the MediaPipe framework through basic hand and pose tracking tutorials (preserved in the `/legacy` directory for reference). 

To support advanced spatiotemporal analytics, I refactored the original monolithic scripts into a modular architecture. The application now decouples raw coordinate extraction from state management and scoring logic, allowing for scalable, real-time biomechanical evaluation.

## Repository Structure

- **`/src/core/`**: Contains the pose tracking engine (`PoseEstimationModule`), responsible for reading frames and extracting normalized $(x,y)$ skeletal coordinates. (`HandTrackingModule` is unused and still on the legacy `mp.solutions` API, which mediapipe 1.x removed, so it no longer runs.)
- **`/src/analytics/`**: Houses the mathematical models for evaluating movement quality — DTW-based form scoring (`form_scoring.py`) and the camera-independent rep-counting state machine (`rep_tracker.py`).
- **`/src/posetrack.py`** and **`/schema/`**: The PoseTrack format shared with the web app. See [Phone / Web App](#phone--web-app).
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

**Status:** tracking, rep counting, calibration, golden-rep recording and form scoring all work, with the same exercises as the Python app. Its rep logic has moved ahead of the desktop app's and no longer matches it. Pick the exercise from the menu under the video; switching exercise resets the counts.

**Both sides are tracked at once**, each with its own rep count, progress bar and last-rep score, in the colour of the limb highlighted on the video (left blue, right yellow). The desktop app measures the right side only.

How a rep is measured:

- **3D angle.** Rep progress uses the angle between MediaPipe's estimated 3D joint positions. The desktop app measures the angle in the flat image, which closes too early when a limb swings toward the camera (a curl filmed from the front).
- **Automatic per-side calibration.** The 3D estimate is imperfect: for the same position it reads the two sides of the body about 10° apart, and it reads differently from different camera positions. So each side learns its own range from its first **3 good reps** — just start training; the panel shows `calibrating 1/3` until it's done, using the default range (`150°→90°` for a curl) meanwhile. Each rep is checked first: it must move at least 30°, take at least 0.6 seconds, and not involve the torso tilting more than 20° (a body swing; this only sees sideways lean, not swinging toward the camera). The range is the median of the 3 reps, so one sloppy rep is outvoted, and 0% and 100% are set 10% inside it so a full rep holds at a flat 100% instead of flickering just under it. If one side ends up with much less range than the other, the app says so. Tap **Calibrate** to relearn both sides from your next 3 good reps (5-second countdown first) — do that if you move the phone or a sloppy first rep set a bad range. Flipping the camera, switching exercise, **Reset calibration** in the debug panel, or reloading starts over. Because each side is measured against its own range, a difference in range of motion between sides shows in the form score, not the bars.
- **Counting.** A rep counts when the bar goes above 85% and comes back below 25%, each for two frames in a row, taking at least 0.4 seconds, and starting from rest. The bar turns white once the top has registered. It does not need to hit exactly 100% and 0%.
- **Hidden limbs.** A side only counts while the camera can see its joints (visibility above 0.6 to start, below 0.4 to stop, three frames each way). The pose model still guesses where a hidden limb is, and that guess moves like a real rep, so a hidden side is frozen, marked "not visible" and never counted. Filmed side-on, this makes it a one-arm session automatically. A rep in progress is dropped if its limb stays hidden for more than a second.

Golden reps and scoring:

- **Recording a golden rep:** tap **Record golden rep**, use the countdown to get into position, then do 3 good full reps. The app keeps the most typical of the three (the one closest to the other two), so one sloppy rep can't become the reference; a rep with a body swing isn't used. It's saved in the browser's storage on that device, one per exercise.
- **Scoring:** every later rep is compared with the golden rep and shown as a match percentage. It compares joint angles in 3D (for a curl: elbow, shoulder and trunk lean; for a squat: knee, hip and trunk lean), aligned with Dynamic Time Warping so rep speed doesn't matter. The distance is the typical angle difference in degrees; 15° or more shows as 0% (`ZERO_MATCH_DEGREES` in `web/src/angleScoring.ts`). Angles read the same whichever side faces the camera, so no mirroring is needed. What angles alone can't see, such as a knee caving inward at an unchanged knee angle, will need joint positions, which are kept for that.
- There is one golden rep for both sides. On the recorded front-view curls, the other arm scores about 4° (25 points) worse than the golden rep's own arm even for good reps, because the pose model reads the two arms slightly differently.
- Record the golden rep from the same camera position you train from: the same curl filmed from the front and from the side is about 16° apart (0%).
- **Old scorer:** add `?scorer=position` to the address to use the earlier position-based scorer (`web/src/formScoring.ts`). Each scorer keeps its own golden rep (stored as v2 and v3), so switching never loses one; the debug panel shows both scores whenever both golden reps exist. From the front, the position scorer gives the other arm's reps 0%: its mirror-image comparison does not hold for that view.
- The scale has been checked against good reps and reps cut off halfway (`web/src/scorerComparison.test.ts`; `SCORER_REPORT=1 npx vitest run src/scorerComparison.test.ts` prints the table), not yet against real bad reps.

**Debug panel.** Tap **Debug** under the controls to see, per side: each joint's visibility, the raw and smoothed 3D angle, the 2D angle for comparison, the active range, the bar value, the rep state and the last rep's score from both scorers, plus the frame rate. **Record landmarks** saves up to a minute of joint coordinates (never video) to a JSON file on the device. Those files replay through the tracker as test fixtures, which is how to turn a tracking problem seen on a phone into a test.

Code layout: `web/src/tracking.ts` is the whole pipeline as a class with no camera or page dependencies (landmarks and a timestamp in, each side's state out); `main.ts` is only camera, drawing and controls. `scripts/extract_landmarks.py` writes the same fixture format from a video file:

```bash
python -m scripts.extract_landmarks videos/clip.mov web/src/fixtures/clip.json
# a screen recording of the app: crop to the camera area and skip the screen's duplicate frames
python -m scripts.extract_landmarks videos/screen.mp4 web/src/fixtures/screen.json --crop X,Y,WIDTH,HEIGHT --step 2
```

**PoseTrack format.** `schema/posetrack.schema.json` defines one format for a set's pose data, so live tracking and a heavier post-workout model can be scored by the same engine. Per frame it holds 12 joints' 3D positions, per-joint confidence, nine joint angles (elbows, shoulders, hips, knees, trunk lean) and whether each angle was measured or filled in; the header declares the coordinate frame, what "up" is and what the confidence numbers mean. `web/src/poseTrack.ts` and `src/posetrack.py` implement it, and a test keeps their angles in agreement. Convert a landmark recording with:

```bash
python -m src.posetrack web/src/fixtures/clip.json clip.posetrack.json --exercise bicep_curl
```

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

The web app has its own unit tests, including replays of real landmark recordings in `web/src/fixtures/`:

```bash
cd web
npm install
npm test
```