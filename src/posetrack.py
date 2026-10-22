"""PoseTrack: the one format every pose source produces (MediaPipe live, GVHMR after the workout),
so one scoring engine reads them all. The format is defined in schema/posetrack.schema.json;
web/src/poseTrack.ts implements the same maths, and tests check the two agree.

Convert a landmark recording (scripts/extract_landmarks.py or the web app's debug recorder):

    python -m src.posetrack web/src/fixtures/curl-side-right.json out.posetrack.json --exercise bicep_curl
"""

import argparse
import json
import math
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema" / "posetrack.schema.json"

# The joints of a track, in the order of each frame's positions and confidence. "l"/"r" are the
# person's own sides.
JOINTS = (
    "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist",
    "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle",
)

# MediaPipe Pose landmark id of each joint.
MEDIAPIPE_LANDMARK = {
    "l_shoulder": 11, "r_shoulder": 12, "l_elbow": 13, "r_elbow": 14, "l_wrist": 15, "r_wrist": 16,
    "l_hip": 23, "r_hip": 24, "l_knee": 25, "r_knee": 26, "l_ankle": 27, "r_ankle": 28,
}

ANGLES = ("l_elbow", "r_elbow", "l_shoulder", "r_shoulder", "l_hip", "r_hip", "l_knee", "r_knee", "trunk_lean")

# The joints each angle is measured from, which also give its confidence (their minimum). A
# three-joint angle is measured at the middle one; trunk_lean is the line from the hip midpoint to
# the shoulder midpoint against the up vector.
ANGLE_JOINTS = {
    "l_elbow": ("l_shoulder", "l_elbow", "l_wrist"),
    "r_elbow": ("r_shoulder", "r_elbow", "r_wrist"),
    "l_shoulder": ("l_hip", "l_shoulder", "l_elbow"),
    "r_shoulder": ("r_hip", "r_shoulder", "r_elbow"),
    "l_hip": ("l_shoulder", "l_hip", "l_knee"),
    "r_hip": ("r_shoulder", "r_hip", "r_knee"),
    "l_knee": ("l_hip", "l_knee", "l_ankle"),
    "r_knee": ("r_hip", "r_knee", "r_ankle"),
    "trunk_lean": ("l_shoulder", "r_shoulder", "l_hip", "r_hip"),
}

# The top of the picture in MediaPipe's world frame, whose y axis points down the image.
MEDIAPIPE_IMAGE_UP = (0.0, -1.0, 0.0)


def js_round(value, places):
    """Round like the web app (JavaScript's Math.round: halves go up), so both sides write the same digits."""
    scale = 10 ** places
    return math.floor(value * scale + 0.5) / scale


def joint_angle(p1, p2, p3):
    """Interior angle in degrees (0-180) at p2 between 3D points, as jointAngle() in web/src/exercises.ts.
    A degenerate angle (a zero-length side) reads 180."""
    u = [p1[i] - p2[i] for i in range(3)]
    v = [p3[i] - p2[i] for i in range(3)]
    lengths = math.hypot(*u) * math.hypot(*v)
    if lengths == 0:
        return 180.0
    cosine = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / lengths
    return math.degrees(math.acos(min(1.0, max(-1.0, cosine))))


def compute_angles(positions, up):
    """Every angle of one pose, in degrees, unrounded. `positions` are in JOINTS order."""
    at = {joint: positions[i] for i, joint in enumerate(JOINTS)}
    angles = {name: joint_angle(*(at[j] for j in ANGLE_JOINTS[name])) for name in ANGLES if name != "trunk_lean"}
    hips = [(at["l_hip"][i] + at["r_hip"][i]) / 2 for i in range(3)]
    shoulders = [(at["l_shoulder"][i] + at["r_shoulder"][i]) / 2 for i in range(3)]
    angles["trunk_lean"] = joint_angle(shoulders, hips, [hips[i] + up[i] for i in range(3)])
    return angles


def angle_confidence(frame, angle):
    """An angle's confidence: the least confident of the joints it is measured from, or None if no one is in view."""
    if frame["confidence"] is None:
        return None
    return min(frame["confidence"][JOINTS.index(joint)] for joint in ANGLE_JOINTS[angle])


def observed_frame(t, positions, confidence, up):
    """One frame from measured positions and confidences: every angle is observed, rounded to 0.01 degrees."""
    if positions is None or confidence is None:
        empty = {name: None for name in ANGLES}
        return {"t": t, "positions": None, "confidence": None, "angles": empty, "origin": dict(empty)}
    raw = compute_angles(positions, up)
    return {
        "t": t,
        "positions": positions,
        "confidence": confidence,
        "angles": {name: js_round(raw[name], 2) for name in ANGLES},
        "origin": {name: "observed" for name in ANGLES},
    }


def mediapipe_header(source, exercise, mirrored):
    """A track's header for MediaPipe world landmarks, measured against the image's vertical."""
    return {
        "format": "posetrack",
        "version": 1,
        "source": source,
        "exercise": exercise,
        "mirrored": mirrored,
        "coordinateFrame": "mediapipe_world",
        "up": {"source": "image_vertical", "vector": list(MEDIAPIPE_IMAGE_UP)},
        "confidenceScale": "mediapipe_visibility",
        "joints": list(JOINTS),
    }


def from_landmark_recording(recording, source, exercise=None):
    """Convert a landmark recording (the format of scripts/extract_landmarks.py) to a PoseTrack."""
    ids = recording["landmarkIds"]
    missing = [joint for joint in JOINTS if MEDIAPIPE_LANDMARK[joint] not in ids]
    if missing:
        raise ValueError(f"recording has no landmark for {', '.join(missing)}")
    column = [ids.index(MEDIAPIPE_LANDMARK[joint]) for joint in JOINTS]
    frames = []
    for frame in recording["frames"]:
        image, world = frame["image"], frame["world"]
        if image is None or world is None:
            frames.append(observed_frame(frame["t"], None, None, MEDIAPIPE_IMAGE_UP))
        else:
            positions = [list(world[i]) for i in column]
            confidence = [image[i][2] for i in column]
            frames.append(observed_frame(frame["t"], positions, confidence, MEDIAPIPE_IMAGE_UP))
    return {**mediapipe_header(source, exercise, recording["mirrored"]), "clip": recording["source"], "frames": frames}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("recording", help="Landmark recording JSON.")
    parser.add_argument("output", help="PoseTrack JSON to write.")
    parser.add_argument("--source", default="mediapipe-pose-full", help="The pose model that made the recording.")
    parser.add_argument("--exercise", help="Exercise name, e.g. bicep_curl.")
    args = parser.parse_args()

    track = from_landmark_recording(json.loads(Path(args.recording).read_text()), args.source, args.exercise)
    Path(args.output).write_text(json.dumps(track, separators=(",", ":")))
    print(f"Wrote {len(track['frames'])} frames to {args.output}")


if __name__ == "__main__":
    main()
