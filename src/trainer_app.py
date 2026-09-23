import argparse
import sys

import cv2
import numpy as np
from src.core import PoseEstimationModule as pm
from src.analytics.form_scoring import FormEvaluator
from src.analytics.rep_tracker import RepTracker
from src.exercises import EXERCISES


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Biomechanical form tracker & rep counter.")
    parser.add_argument("--camera", type=int, default=0,
                         help="Camera device index to use (default: 0). Ignored if --video is given.")
    parser.add_argument("--video", type=str, default=None,
                         help="Path to a video file to use instead of a live camera.")
    parser.add_argument("--exercise", type=str, default="bicep_curl", choices=sorted(EXERCISES),
                         help="Exercise to track (default: bicep_curl).")
    parser.add_argument("--angle-range", type=float, nargs=2, default=None,
                         metavar=("MIN", "MAX"),
                         help="Override the exercise's default angle range "
                              "(degrees mapped to 0-100%% of the rep).")
    parser.add_argument("--golden-rep-path", type=str, default=None,
                         help="Path to save/load the golden rep "
                              "(default: golden_reps/<exercise>.npy).")
    return parser.parse_args(argv)


def resolve_angle_range(exercise, angle_range_arg):
    """The --angle-range flag overrides the exercise's built-in range when given."""
    return tuple(angle_range_arg) if angle_range_arg else exercise.angle_range


def resolve_golden_rep_path(exercise, golden_rep_path_arg):
    """The --golden-rep-path flag overrides the per-exercise default path when given."""
    return golden_rep_path_arg or f"golden_reps/{exercise.name}.npy"


def main():
    args = parse_args()
    exercise = EXERCISES[args.exercise]
    angle_range = resolve_angle_range(exercise, args.angle_range)
    golden_rep_path = resolve_golden_rep_path(exercise, args.golden_rep_path)

    source = args.video if args.video else args.camera
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"Error: could not open video source {source!r}", file=sys.stderr)
        sys.exit(1)

    detector = pm.poseDetector()
    tracker = RepTracker(FormEvaluator())

    if tracker.load_golden_rep(golden_rep_path):
        print(f"Loaded golden rep from {golden_rep_path} "
              f"({len(tracker.golden_rep_frames)} frames).")

    while True:
        success, img = cap.read()
        if not success:
            break

        img = detector.findPose(img, False)
        lmList = detector.getPosition(img, False)

        if len(lmList) != 0:
            # Extract clean (x, y) coordinates for the evaluator
            current_frame_coords = np.array([[lm[1], lm[2]] for lm in lmList])

            angle = detector.findAngle(img, *exercise.joints)
            per = np.interp(angle, angle_range, (0, 100))
            bar = np.interp(angle, angle_range, (650, 100))

            tracker.update(per, current_frame_coords)

            # --- DRAWING UI ---
            if tracker.is_recording_golden:
                cv2.putText(img, "RECORDING GOLDEN REP", (50, 50),
                            cv2.FONT_HERSHEY_PLAIN, 3, (0, 0, 255), 3)

            cv2.rectangle(img, (1100, 100), (1175, 650), (255, 0, 0), cv2.FILLED)
            cv2.rectangle(img, (1100, int(bar)), (1175, 650), (255, 0, 0), cv2.FILLED)
            cv2.putText(img, str(int(per)), (1100, 75), cv2.FONT_HERSHEY_PLAIN, 4, (255, 0, 255), 4)

            # Draw exercise label and rep count
            cv2.putText(img, exercise.label, (50, 100), cv2.FONT_HERSHEY_PLAIN, 3, (255, 255, 0), 3)
            cv2.putText(img, f"Reps: {int(tracker.count)}", (50, 150), cv2.FONT_HERSHEY_PLAIN, 5, (255, 255, 0), 5)

            # Draw the latest form score if a golden rep is saved
            if tracker.golden_rep_saved:
                cv2.putText(img, f"Form Score: {tracker.last_score:.2f}", (50, 210),
                            cv2.FONT_HERSHEY_PLAIN, 3, (0, 255, 0), 3)

        cv2.imshow("Image", img)

        # --- KEYBOARD CONTROLS ---
        key = cv2.waitKey(1)
        if key == ord('g'):
            recording = tracker.toggle_golden_recording()
            if not recording and tracker.golden_rep_saved:
                tracker.save_golden_rep(golden_rep_path)
                print(f"Golden rep saved to {golden_rep_path} "
                      f"({len(tracker.golden_rep_frames)} frames).")
        elif key == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
