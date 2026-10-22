import copy
import json
from pathlib import Path

import jsonschema
import pytest

from src.posetrack import (
    ANGLE_JOINTS,
    ANGLES,
    JOINTS,
    MEDIAPIPE_IMAGE_UP,
    SCHEMA_PATH,
    angle_confidence,
    compute_angles,
    from_landmark_recording,
    joint_angle,
    js_round,
    observed_frame,
)

FIXTURES = Path(__file__).resolve().parent.parent / "web" / "src" / "fixtures"
SCHEMA = json.loads(SCHEMA_PATH.read_text())


def load(name):
    return json.loads((FIXTURES / name).read_text())


def upright_pose():
    """A person standing straight, arms hanging, in MediaPipe's world frame (y down)."""
    p = {
        "l_shoulder": [0.2, -0.5, 0], "r_shoulder": [-0.2, -0.5, 0],
        "l_elbow": [0.2, -0.2, 0], "r_elbow": [-0.2, -0.2, 0],
        "l_wrist": [0.2, 0.1, 0], "r_wrist": [-0.2, 0.1, 0],
        "l_hip": [0.1, 0, 0], "r_hip": [-0.1, 0, 0],
        "l_knee": [0.1, 0.45, 0], "r_knee": [-0.1, 0.45, 0],
        "l_ankle": [0.1, 0.9, 0], "r_ankle": [-0.1, 0.9, 0],
    }
    return [p[joint] for joint in JOINTS]


def test_schema_is_a_valid_json_schema():
    jsonschema.Draft202012Validator.check_schema(SCHEMA)


def test_schema_and_code_list_the_same_joints_and_angles():
    assert SCHEMA["properties"]["joints"]["const"] == list(JOINTS)
    assert SCHEMA["$defs"]["frame"]["properties"]["angles"]["required"] == list(ANGLES)
    assert set(ANGLE_JOINTS) == set(ANGLES)


def test_joint_angle():
    assert joint_angle([1, 0, 0], [0, 0, 0], [0, 1, 0]) == pytest.approx(90)
    assert joint_angle([1, 0, 0], [0, 0, 0], [-1, 0, 0]) == pytest.approx(180)
    assert joint_angle([1, 1, 0], [0, 0, 0], [0, 0, 1]) == pytest.approx(90)
    assert joint_angle([0, 0, 0], [0, 0, 0], [1, 0, 0]) == 180  # degenerate


def test_upright_pose_angles():
    angles = compute_angles(upright_pose(), MEDIAPIPE_IMAGE_UP)
    assert angles["l_elbow"] == pytest.approx(180)
    assert angles["r_knee"] == pytest.approx(180)
    assert angles["trunk_lean"] == pytest.approx(0)
    assert angles["l_hip"] > 165  # shoulders sit wider than hips, so not quite straight


def test_trunk_lean_is_measured_against_the_given_up():
    pose = upright_pose()
    assert compute_angles(pose, (0, -1, 0))["trunk_lean"] == pytest.approx(0)
    assert compute_angles(pose, (1, 0, 0))["trunk_lean"] == pytest.approx(90)
    half = 2 ** -0.5
    assert compute_angles(pose, (half, -half, 0))["trunk_lean"] == pytest.approx(45)


def test_trunk_lean_is_unsigned():
    pose = upright_pose()
    forward = [[x, y, z - 0.5 * (y < -0.4)] for x, y, z in pose]
    back = [[x, y, z + 0.5 * (y < -0.4)] for x, y, z in pose]
    lean_forward = compute_angles(forward, MEDIAPIPE_IMAGE_UP)["trunk_lean"]
    assert lean_forward > 30
    assert compute_angles(back, MEDIAPIPE_IMAGE_UP)["trunk_lean"] == pytest.approx(lean_forward)


def test_angle_confidence_is_the_minimum_of_its_joints():
    confidence = [0.9] * len(JOINTS)
    confidence[JOINTS.index("r_hip")] = 0.2
    frame = observed_frame(0, upright_pose(), confidence, MEDIAPIPE_IMAGE_UP)
    assert angle_confidence(frame, "l_elbow") == 0.9
    assert angle_confidence(frame, "r_knee") == 0.2
    assert angle_confidence(frame, "r_shoulder") == 0.2
    # trunk_lean uses both shoulders and both hips.
    assert angle_confidence(frame, "trunk_lean") == 0.2
    confidence[JOINTS.index("r_hip")] = 0.9
    confidence[JOINTS.index("l_shoulder")] = 0.3
    frame = observed_frame(0, upright_pose(), confidence, MEDIAPIPE_IMAGE_UP)
    assert angle_confidence(frame, "trunk_lean") == 0.3


def test_frame_with_no_one_in_view():
    frame = observed_frame(5, None, None, MEDIAPIPE_IMAGE_UP)
    assert frame["positions"] is None and frame["confidence"] is None
    assert all(frame["angles"][name] is None and frame["origin"][name] is None for name in ANGLES)
    assert angle_confidence(frame, "l_elbow") is None


def test_js_round_rounds_halves_up_like_javascript():
    assert js_round(0.125, 2) == 0.13
    assert js_round(-0.125, 2) == -0.12
    assert js_round(1.005, 2) == 1.0  # 1.005 is just below in binary, as in JavaScript


def test_checked_in_fixture_is_current():
    """web/src/fixtures/curl-side-right.posetrack.json is what this module writes; the web tests check
    their own conversion against it. Regenerate with:
    python -m src.posetrack web/src/fixtures/curl-side-right.json web/src/fixtures/curl-side-right.posetrack.json --exercise bicep_curl"""
    expected = from_landmark_recording(load("curl-side-right.json"), "mediapipe-pose-full", "bicep_curl")
    assert load("curl-side-right.posetrack.json") == json.loads(json.dumps(expected))


@pytest.mark.parametrize("name", ["curl-side-right.json", "curl-side-left-mirrored.json", "curl-front-screenrec.json"])
def test_converted_recordings_match_the_schema(name):
    recording = load(name)
    track = from_landmark_recording(recording, "mediapipe-pose-full", "bicep_curl")
    jsonschema.validate(track, SCHEMA)
    assert track["mirrored"] == recording["mirrored"]
    assert len(track["frames"]) == len(recording["frames"])
    for frame in track["frames"]:
        assert all((frame["angles"][n] is None) == (frame["origin"][n] is None) for n in ANGLES)


def test_recording_gaps_become_empty_frames():
    track = from_landmark_recording(load("curl-front-screenrec.json"), "mediapipe-pose-full")
    empty = [frame for frame in track["frames"] if frame["positions"] is None]
    assert empty  # this recording has frames with no one in view
    assert all(frame["angles"]["l_elbow"] is None for frame in empty)


def test_mirroring_swaps_sides():
    """The mirrored fixture is the same video flipped, so its left elbow is the person's right."""
    right = from_landmark_recording(load("curl-side-right.json"), "mediapipe-pose-full")["frames"]
    mirrored = from_landmark_recording(load("curl-side-left-mirrored.json"), "mediapipe-pose-full")["frames"]
    diffs = [abs(a["angles"]["r_elbow"] - b["angles"]["l_elbow"]) for a, b in zip(right, mirrored)]
    assert sorted(diffs)[len(diffs) // 2] < 10


def test_schema_requires_an_up_vector_somewhere():
    track = from_landmark_recording(load("curl-side-right.json"), "mediapipe-pose-full")
    no_vector = copy.deepcopy(track)
    del no_vector["up"]["vector"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(no_vector, SCHEMA)
    for frame in no_vector["frames"]:
        frame["up"] = list(MEDIAPIPE_IMAGE_UP)
    jsonschema.validate(no_vector, SCHEMA)


def test_schema_rejects_malformed_frames():
    track = from_landmark_recording(load("curl-side-right.json"), "mediapipe-pose-full")
    for mutate in (
        lambda t: t["frames"][0]["positions"].pop(),
        lambda t: t["frames"][0]["angles"].pop("trunk_lean"),
        lambda t: t["frames"][0]["angles"].update(l_elbow=181),
        lambda t: t["frames"][0]["origin"].update(l_elbow="guessed"),
        lambda t: t.update(coordinateFrame="camera"),
    ):
        broken = copy.deepcopy(track)
        mutate(broken)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(broken, SCHEMA)
