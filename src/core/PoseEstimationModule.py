import math
import os
import shutil
import ssl
import sys
import time
import urllib.request
from pathlib import Path

import certifi
import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    PoseLandmarker,
    PoseLandmarkerOptions,
    PoseLandmarksConnections,
    RunningMode,
    drawing_utils,
)

MODEL_VARIANTS = {0: "lite", 1: "full", 2: "heavy"}
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_{variant}/float16/latest/pose_landmarker_{variant}.task"
)


# mediapipe 1.0.1's macOS build aborts on the CPU delegate (a Metal helper
# fails with "Service is unavailable"), so macOS uses the Metal GPU delegate,
# which only accepts 4-channel RGBA frames.
USE_GPU = sys.platform == "darwin"


class ModelDownloadError(RuntimeError):
    pass


def _download(url, dest):
    # certifi's CA bundle, because python.org macOS builds don't use the system
    # certificate store and would otherwise fail HTTPS verification.
    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(url, context=context) as response, open(dest, "wb") as f:
        shutil.copyfileobj(response, f)


def default_cache_dir():
    base = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
    return Path(base) / "form-trainer"


def ensure_model(complexity=1, cache_dir=None):
    """Return the path to the pose model for `complexity` (0=lite, 1=full,
    2=heavy), downloading it into `cache_dir` on first use."""
    variant = MODEL_VARIANTS[complexity]
    cache_dir = Path(cache_dir) if cache_dir else default_cache_dir()
    path = cache_dir / f"pose_landmarker_{variant}.task"
    if path.exists():
        return path

    url = MODEL_URL.format(variant=variant)
    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".task.part")
    try:
        _download(url, tmp_path)
    except OSError as e:
        tmp_path.unlink(missing_ok=True)
        raise ModelDownloadError(f"could not download pose model from {url}: {e}") from e
    # Rename only after a complete download so an interrupted one never leaves a corrupt model.
    tmp_path.replace(path)
    return path


class poseDetector:
    def __init__(self, complexity=1, min_detection_confidence=0.5,
                 min_tracking_confidence=0.5, model_path=None):
        model_path = model_path or ensure_model(complexity)
        options = PoseLandmarkerOptions(
            base_options=BaseOptions(
                model_asset_path=str(model_path),
                delegate=BaseOptions.Delegate.GPU if USE_GPU else BaseOptions.Delegate.CPU,
            ),
            running_mode=RunningMode.VIDEO,
            min_pose_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self.landmarker = PoseLandmarker.create_from_options(options)
        self.results = None
        self.lmList = []
        self._start_time = time.monotonic()
        self._last_timestamp_ms = -1

    def findPose(self, img, draw=True, timestamp_ms=None):
        """Run pose detection on a BGR frame. `timestamp_ms` should be the
        frame's position in the stream (e.g. from a video file); when omitted,
        elapsed wall-clock time is used, which suits a live camera."""
        if timestamp_ms is None:
            timestamp_ms = int((time.monotonic() - self._start_time) * 1000)
        # VIDEO mode rejects timestamps that don't strictly increase.
        timestamp_ms = max(int(timestamp_ms), self._last_timestamp_ms + 1)
        self._last_timestamp_ms = timestamp_ms

        if USE_GPU:
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGBA,
                                data=cv2.cvtColor(img, cv2.COLOR_BGR2RGBA))
        else:
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB,
                                data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        self.results = self.landmarker.detect_for_video(mp_image, timestamp_ms)

        if draw and self.results.pose_landmarks:
            drawing_utils.draw_landmarks(img, self.results.pose_landmarks[0],
                                         PoseLandmarksConnections.POSE_LANDMARKS)

        return img

    def getPosition(self, img, draw=True):
        self.lmList = []
        if self.results and self.results.pose_landmarks:
            h, w, _ = img.shape
            for id, lm in enumerate(self.results.pose_landmarks[0]):
                cx, cy = int(lm.x * w), int(lm.y * h)
                self.lmList.append([id, cx, cy])
                if draw:
                    cv2.circle(img, (cx, cy), 5, (255, 0, 255), cv2.FILLED)
        return self.lmList

    def findAngle(self, img, p1, p2, p3, draw=True):

        #Get the landmarks
        x1, y1 = self.lmList[p1][1:]
        x2, y2 = self.lmList[p2][1:]
        x3, y3 = self.lmList[p3][1:]

        #Calculate the angle
        angle = math.degrees(math.atan2(y3-y2,x3-x2) -
                             math.atan2(y1-y2,x1-x2))

        if angle < 0:
             angle += 360

        #Draw
        if draw:
            cv2.line(img, (x1,y1),(x2,y2), (255,255,0),3)
            cv2.line(img, (x3,y3),(x2,y2), (255,255,0),3)
            cv2.circle(img, (x1, y1), 5, (255, 0, 0), cv2.FILLED)
            cv2.circle(img, (x1, y1), 10, (255, 0, 0), 2)
            cv2.circle(img, (x2, y2), 5, (255, 0, 0), cv2.FILLED)
            cv2.circle(img, (x2, y2), 10, (255, 0, 0), 2)
            cv2.circle(img, (x3, y3), 5, (255, 0, 0), cv2.FILLED)
            cv2.circle(img, (x3, y3), 10, (255, 0, 0), 2)
            cv2.putText(img, str(int(angle)),(x2-20,y2+50),cv2.FONT_HERSHEY_SIMPLEX,2,(255,0,255),2)

        return angle

    def close(self):
        self.landmarker.close()


def main():
    cap = cv2.VideoCapture(0)
    pTime = 0
    detector = poseDetector()
    while True:
        success, img = cap.read()
        if not success:
            break
        img = detector.findPose(img)
        detector.getPosition(img)

        cTime = time.time()
        fps = 1 / (cTime - pTime)
        pTime = cTime

        cv2.putText(img, str(int(fps)), (70, 50), cv2.FONT_HERSHEY_SIMPLEX, 3, (255, 0, 0), 3)

        cv2.imshow("Image", img)
        if cv2.waitKey(1) == ord('q'):
            break

    cap.release()
    detector.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
