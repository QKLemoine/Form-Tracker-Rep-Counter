import argparse
import sys

import cv2
import numpy as np
from core import PoseEstimationModule as pm
from analytics.form_scoring import FormEvaluator
from analytics.rep_tracker import RepTracker


def parse_args():
    parser = argparse.ArgumentParser(description="Biomechanical form tracker & rep counter.")
    parser.add_argument("--camera", type=int, default=0,
                         help="Camera device index to use (default: 0). Ignored if --video is given.")
    parser.add_argument("--video", type=str, default=None,
                         help="Path to a video file to use instead of a live camera.")
    parser.add_argument("--angle-range", type=float, nargs=2, default=[210, 310],
                         metavar=("MIN", "MAX"),
                         help="Angle range (degrees) mapped to 0-100%% of the rep (default: 210 310).")
    parser.add_argument("--golden-rep-path", type=str, default="golden_rep.npy",
                         help="Path to save/load the golden rep (default: golden_rep.npy).")
    return parser.parse_args()


def main():
    args = parse_args()
    angle_range = tuple(args.angle_range)

    source = args.video if args.video else args.camera
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"Error: could not open video source {source!r}", file=sys.stderr)
        sys.exit(1)

    detector = pm.poseDetector()
    tracker = RepTracker(FormEvaluator())

    if tracker.load_golden_rep(args.golden_rep_path):
        print(f"Loaded golden rep from {args.golden_rep_path} "
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

            # Right Arm Angle
            angle = detector.findAngle(img, 12, 14, 16)
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

            # Draw rep count
            cv2.putText(img, f"Reps: {int(tracker.count)}", (50, 100), cv2.FONT_HERSHEY_PLAIN, 5, (255, 255, 0), 5)

            # Draw the latest form score if a golden rep is saved
            if tracker.golden_rep_saved:
                cv2.putText(img, f"Form Score: {tracker.last_score:.2f}", (50, 160),
                            cv2.FONT_HERSHEY_PLAIN, 3, (0, 255, 0), 3)

        cv2.imshow("Image", img)

        # --- KEYBOARD CONTROLS ---
        key = cv2.waitKey(1)
        if key == ord('g'):
            recording = tracker.toggle_golden_recording()
            if not recording and tracker.golden_rep_saved:
                tracker.save_golden_rep(args.golden_rep_path)
                print(f"Golden rep saved to {args.golden_rep_path} "
                      f"({len(tracker.golden_rep_frames)} frames).")
        elif key == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
