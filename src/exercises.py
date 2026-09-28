from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Exercise:
    """Definition of a trackable exercise: which three MediaPipe Pose
    landmarks form the tracked joint angle, and the angle range mapped to a
    rep. `angle_range` is (start, end) in interior degrees (0-180): `start`
    is the resting position (0% of the rep) and `end` the peak (100%)."""

    name: str
    label: str
    joints: tuple[int, int, int]
    angle_range: tuple[float, float]


def angle_to_percent(angle, angle_range):
    """Map a joint angle onto 0-100% of the rep, clipped at both ends. The
    range may run in either direction (e.g. a curl closes the elbow from
    150 down to 50)."""
    start, end = angle_range
    if start < end:
        return float(np.interp(angle, (start, end), (0, 100)))
    return float(np.interp(angle, (end, start), (100, 0)))


EXERCISES = {
    "bicep_curl": Exercise(
        name="bicep_curl",
        label="Bicep Curl",
        joints=(12, 14, 16),  # right shoulder, elbow, wrist
        angle_range=(150, 50),
    ),
    "squat": Exercise(
        name="squat",
        label="Squat",
        joints=(24, 26, 28),  # right hip, knee, ankle
        angle_range=(170, 90),  # placeholder — uncalibrated, see README
    ),
}
