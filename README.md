# Biomechanical Form Tracker & Rep Counter

A computer vision application that utilizes spatial tracking and skeletal landmark detection to analyze workout biomechanics, count repetitions, and evaluate exercise form quality.

## Project Evolution

This project began as an exploration of the MediaPipe framework through basic hand and pose tracking tutorials (preserved in the `/legacy` directory for reference). 

To support advanced spatiotemporal analytics, I refactored the original monolithic scripts into a modular architecture. The application now decouples raw coordinate extraction from state management and scoring logic, allowing for scalable, real-time biomechanical evaluation.

## Repository Structure

- **`/src/core/`**: Contains the decoupled tracking engines (`HandTrackingModule`, `PoseEstimationModule`) responsible for reading frames and extracting normalized $(x,y)$ skeletal coordinates.
- **`/src/analytics/`**: Houses the mathematical models for evaluating movement quality — DTW-based form scoring (`form_scoring.py`) and the camera-independent rep-counting state machine (`rep_tracker.py`).
- **`/src/exercises.py`**: The exercise registry — each exercise defines its tracked joint triple, angle range, and display label. See [Exercises](#exercises) below.
- **`/src/trainer_app.py`**: The main execution node that bridges the vision pipeline, scoring logic, and UI rendering.
- **`/legacy/`**: Original tutorial scripts and early experimental monolithic code.
- **`/tests/`**: Unit tests for the analytics layer.
- **`pyproject.toml`**: Packaging config — makes `src` an installable package (`pip install -e .`) and defines the `form-trainer` console script.

## Current Features

- Real-time pose estimation and skeletal landmark extraction via MediaPipe.
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
3. Run it from the repo root, either via the console script or as a module:
   ```bash
   form-trainer
   # or
   python -m src.trainer_app
   ```
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
| `--angle-range MIN MAX` | *(exercise's default)* | Overrides the selected exercise's angle range (degrees mapped to 0-100% of the rep). |
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

- **`bicep_curl`** (default) — tracks the right shoulder/elbow/wrist angle. Angle range `210 310` was tuned against an actual recorded curl.
- **`squat`** — tracks the right hip/knee/ankle angle. **Experimental and uncalibrated**: the `90 170` angle range in the registry is a placeholder, not tuned against real reps, and squats need a side-on camera angle for the hip/knee/ankle triple to read correctly (the front-on framing that works for `bicep_curl` won't). Use `--angle-range` to override it until the registry default is calibrated.

Each exercise also gets its own golden-rep file (`golden_reps/<exercise>.npy` by default — see below), so recording a golden squat rep won't overwrite a recorded bicep curl rep. That path is relative to wherever you run the app from — e.g. `<repo root>/golden_reps/` when run via `form-trainer` from the repo root.

## How It Works: Golden Rep Scoring

1. Press `g` to start recording a "golden" rep — the reference form you want later reps scored against. Perform one rep, then press `g` again to stop; the recorded frames are locked in as the golden rep and saved to disk at `--golden-rep-path` (`golden_reps/<exercise>.npy` by default).
2. From then on, every completed rep is compared against the golden rep using Dynamic Time Warping (`FormEvaluator` in `src/analytics/form_scoring.py`), and a form score is drawn on screen.
3. On the next run, the app automatically loads the golden rep from `--golden-rep-path` at startup (if the file exists), so you don't need to re-record it every session. If the file is missing or unreadable, the app just starts without a golden rep, as if none had been recorded yet.

## Testing

Install dev dependencies and run the test suite from the repo root:

```bash
pip install -r requirements-dev.txt
pytest
```