import cv2
import numpy as np
from core import PoseEstimationModule as pm
from analytics.form_scoring import FormEvaluator
from analytics.rep_tracker import RepTracker

ANGLE_RANGE = (210, 310)

cap = cv2.VideoCapture(0)
if not cap.isOpened():
    raise RuntimeError("Could not open webcam (index 0).")

detector = pm.poseDetector()
tracker = RepTracker(FormEvaluator())

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
        per = np.interp(angle, ANGLE_RANGE, (0, 100))
        bar = np.interp(angle, ANGLE_RANGE, (650, 100))

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
            print(f"Golden rep saved: {len(tracker.golden_rep_frames)} frames.")
    elif key == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
