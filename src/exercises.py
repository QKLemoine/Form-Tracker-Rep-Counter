from dataclasses import dataclass


@dataclass(frozen=True)
class Exercise:
    """Definition of a trackable exercise: which three MediaPipe Pose
    landmarks form the tracked joint angle, and the angle range (in
    degrees) mapped to 0-100% of a rep."""

    name: str
    label: str
    joints: tuple[int, int, int]
    angle_range: tuple[float, float]


EXERCISES = {
    "bicep_curl": Exercise(
        name="bicep_curl",
        label="Bicep Curl",
        joints=(12, 14, 16),  # right shoulder, elbow, wrist
        angle_range=(210, 310),
    ),
    "squat": Exercise(
        name="squat",
        label="Squat",
        joints=(24, 26, 28),  # right hip, knee, ankle
        angle_range=(90, 170),  # placeholder — uncalibrated, see README
    ),
}
