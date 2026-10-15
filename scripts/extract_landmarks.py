"""Extract per-frame pose landmarks from a video into a JSON fixture for the web app's tests.

Only joint coordinates are written, never video frames. The format matches what the web app's
debug overlay records, so files from either source can be used as test fixtures.

    python -m scripts.extract_landmarks videos/clip.mov web/src/fixtures/clip.json [--mirror]

For a screen recording of the app, crop to the camera area and skip the screen's duplicate frames:

    python -m scripts.extract_landmarks videos/screen.mp4 out.json --crop 194,342,902,1615 --step 2
"""

import argparse
import json
from pathlib import Path

import cv2

from src.core import PoseEstimationModule as pm

# Shoulders, elbows, wrists, hips, knees, ankles: every landmark the exercises and scoring use.
LANDMARK_IDS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]


def extract(video_path, mirror=False, width=720, crop=None, step=1):
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise SystemExit(f"Error: could not open video {str(video_path)!r}")

    detector = pm.poseDetector()
    frames = []
    size = None
    index = -1
    while True:
        ok, img = cap.read()
        if not ok:
            break
        index += 1
        if index % step:
            continue
        t = cap.get(cv2.CAP_PROP_POS_MSEC)
        if crop:
            x, y, cw, ch = crop
            img = img[y:y + ch, x:x + cw]
        h, w = img.shape[:2]
        img = cv2.resize(img, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)
        if mirror:
            img = cv2.flip(img, 1)
        size = (img.shape[1], img.shape[0])

        detector.findPose(img, draw=False, timestamp_ms=t)
        result = detector.results
        frame = {"t": round(t, 1), "image": None, "world": None}
        if result.pose_landmarks:
            image, world = result.pose_landmarks[0], result.pose_world_landmarks[0]
            frame["image"] = [[round(image[i].x, 4), round(image[i].y, 4), round(image[i].visibility, 3)] for i in LANDMARK_IDS]
            frame["world"] = [[round(world[i].x, 4), round(world[i].y, 4), round(world[i].z, 4)] for i in LANDMARK_IDS]
        frames.append(frame)
    detector.close()
    cap.release()

    return {
        "source": Path(video_path).name,
        "mirrored": mirror,
        "width": size[0],
        "height": size[1],
        "landmarkIds": LANDMARK_IDS,
        "frames": frames,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video")
    parser.add_argument("output")
    parser.add_argument("--mirror", action="store_true", help="Flip the video left-right first, so the other arm is the one in view.")
    parser.add_argument("--crop", help="Only use this region of each frame: X,Y,WIDTH,HEIGHT in pixels.")
    parser.add_argument("--step", type=int, default=1, help="Use every Nth frame (2 for a 60 fps screen recording of a 30 fps camera).")
    args = parser.parse_args()

    crop = tuple(int(v) for v in args.crop.split(",")) if args.crop else None
    data = extract(args.video, mirror=args.mirror, crop=crop, step=args.step)
    Path(args.output).write_text(json.dumps(data, separators=(",", ":")))
    print(f"Wrote {len(data['frames'])} frames to {args.output}")


if __name__ == "__main__":
    main()
