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

## Upcoming Features (In Development)

- **Dynamic Time Warping (DTW):** Implementing time-series sequence alignment to compare live repetitions against a "golden" ideal repetition, calculating a normalized form-error score regardless of rep speed.

## How to Run

1. Clone the repository and navigate to the root folder.
2. Create a virtual environment and install the dependencies:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
3. Run the trainer app from the `src` directory:
   ```bash
   cd src
   python trainer_app.py
   ```
4. Controls:
   - `g` — start/stop recording a "golden" rep (the reference form to score against).
   - `q` — quit.

## Testing

Install dev dependencies and run the test suite from the repo root:

```bash
pip install -r requirements-dev.txt
pytest
```