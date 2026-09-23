# Biomechanical Form Tracker & Rep Counter

A computer vision application that utilizes spatial tracking and skeletal landmark detection to analyze workout biomechanics, count repetitions, and evaluate exercise form quality.

## Project Evolution

This project began as an exploration of the MediaPipe framework through basic hand and pose tracking tutorials (preserved in the `/legacy` directory for reference). 

To support advanced spatiotemporal analytics, I refactored the original monolithic scripts into a modular architecture. The application now decouples raw coordinate extraction from state management and scoring logic, allowing for scalable, real-time biomechanical evaluation.

## Repository Structure

- **`/src/core/`**: Contains the decoupled tracking engines (`HandTrackingModule`, `PoseEstimationModule`) responsible for reading frames and extracting normalized $(x,y)$ skeletal coordinates.
- **`/src/analytics/`**: Houses the mathematical models for evaluating movement quality — DTW-based form scoring (`form_scoring.py`) and the camera-independent rep-counting state machine (`rep_tracker.py`).
- **`/src/trainer_app.py`**: The main execution node that bridges the vision pipeline, scoring logic, and UI rendering.
- **`/legacy/`**: Original tutorial scripts and early experimental monolithic code.
- **`/tests/`**: Unit tests for the analytics layer.

## Current Features

- Real-time pose estimation and skeletal landmark extraction via MediaPipe.
- Biomechanical angle calculation (e.g., elbow and shoulder joint angles).
- State-machine-based repetition counting and set progression tracking.
- **Dynamic Time Warping (DTW) form scoring:** compares live repetitions against a recorded "golden" ideal repetition, calculating a normalized form-error score regardless of rep speed. See [How It Works](#how-it-works-golden-rep-scoring) below.

## How to Run

1. Clone the repository and navigate to the root folder.
2. Create a virtual environment and install the dependencies:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
3. The app currently has to be run from inside `src/` (it isn't packaged yet, so its `core`/`analytics` imports only resolve from there):
   ```bash
   cd src
   python trainer_app.py
   ```
4. Controls:
   - `g` — start/stop recording a "golden" rep (the reference form to score against).
   - `q` — quit.

### CLI flags

All flags are optional; run `python trainer_app.py --help` to see them from the app itself.

| Flag | Default | Description |
| --- | --- | --- |
| `--camera CAMERA` | `0` | Camera device index to use. Ignored if `--video` is given. |
| `--video VIDEO` | *(none)* | Path to a video file to use instead of a live camera. |
| `--angle-range MIN MAX` | `210 310` | Angle range (degrees) mapped to 0-100% of the rep. |
| `--golden-rep-path GOLDEN_REP_PATH` | `golden_rep.npy` | Path to save/load the golden rep. |

Example — run against a recorded clip instead of a webcam:
```bash
python trainer_app.py --video path/to/clip.mp4
```

## How It Works: Golden Rep Scoring

1. Press `g` to start recording a "golden" rep — the reference form you want later reps scored against. Perform one rep, then press `g` again to stop; the recorded frames are locked in as the golden rep and saved to disk at `--golden-rep-path` (`golden_rep.npy` by default).
2. From then on, every completed rep is compared against the golden rep using Dynamic Time Warping (`FormEvaluator` in `src/analytics/form_scoring.py`), and a form score is drawn on screen.
3. On the next run, the app automatically loads the golden rep from `--golden-rep-path` at startup (if the file exists), so you don't need to re-record it every session. If the file is missing or unreadable, the app just starts without a golden rep, as if none had been recorded yet.

## Testing

Install dev dependencies and run the test suite from the repo root:

```bash
pip install -r requirements-dev.txt
pytest
```