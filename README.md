# Biomechanical Form Tracker & Rep Counter

A computer vision application that utilizes spatial tracking and skeletal landmark detection to analyze workout biomechanics, count repetitions, and evaluate exercise form quality.

## Project Evolution

This project began as an exploration of the MediaPipe framework through basic hand and pose tracking tutorials (preserved in the `/legacy` directory for reference). 

To support advanced spatiotemporal analytics, I refactored the original monolithic scripts into a modular architecture. The application now decouples raw coordinate extraction from state management and scoring logic, allowing for scalable, real-time biomechanical evaluation.

## Repository Structure

- **`/src/core/`**: Contains the decoupled tracking engines (`HandTrackingModule`, `PoseEstimationModule`) responsible for reading frames and extracting normalized $(x,y)$ skeletal coordinates.
- **`/src/analytics/`**: Houses the mathematical models for evaluating movement quality (e.g., Dynamic Time Warping for form scoring).
- **`/src/trainer_app.py`**: The main execution node that bridges the vision pipeline, scoring logic, and UI rendering.
- **`/legacy/`**: Original tutorial scripts and early experimental monolithic code.

## Current Features

- Real-time pose estimation and skeletal landmark extraction via MediaPipe.
- Biomechanical angle calculation (e.g., elbow and shoulder joint angles).
- State-machine-based repetition counting and set progression tracking.

## Upcoming Features (In Development)

- **Dynamic Time Warping (DTW):** Implementing time-series sequence alignment to compare live repetitions against a "golden" ideal repetition, calculating a normalized form-error score regardless of rep speed.

## How to Run

1. Clone the repository and navigate to the root folder.
2. Install the required dependencies (requires OpenCV and MediaPipe):
   ```bash
   pip install opencv-python mediapipe numpy