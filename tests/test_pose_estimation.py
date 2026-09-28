import numpy as np
import pytest

from src.core import PoseEstimationModule as pm


@pytest.fixture(scope="module")
def detector():
    # Uses the real model (downloaded to the cache on first run) so a breaking
    # mediapipe upgrade fails here instead of only at app startup.
    d = pm.poseDetector()
    yield d
    d.close()


def test_detector_runs_inference_on_a_frame(detector):
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    detector.findPose(blank, draw=False)
    assert detector.getPosition(blank, draw=False) == []


def test_detector_tolerates_non_increasing_timestamps(detector):
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    detector.findPose(blank, draw=False, timestamp_ms=10_000)
    detector.findPose(blank, draw=False, timestamp_ms=10_000)
    detector.findPose(blank, draw=False, timestamp_ms=5_000)


@pytest.mark.parametrize("p1, p2, p3, expected", [
    ((0, -1), (0, 0), (1, 0), 90),    # right angle
    ((0, -1), (0, 0), (0, 1), 180),   # straight limb
    ((1, 1), (0, 0), (1, 0), 45),
])
def test_joint_angle_is_interior(p1, p2, p3, expected):
    assert pm.joint_angle(p1, p2, p3) == pytest.approx(expected)


def test_joint_angle_is_the_same_for_a_mirrored_view():
    # The same elbow seen from the other side is mirrored left-right; the
    # interior angle must not change (the old signed angle read 360 - x).
    shoulder, elbow, wrist = (0, -10), (0, 0), (7, 5)
    mirror = lambda p: (-p[0], p[1])
    assert pm.joint_angle(shoulder, elbow, wrist) == pytest.approx(
        pm.joint_angle(mirror(shoulder), mirror(elbow), mirror(wrist)))


def test_ensure_model_reuses_cached_file(tmp_path, monkeypatch):
    cached = tmp_path / "pose_landmarker_full.task"
    cached.write_bytes(b"model")

    def fail_download(*args):
        raise AssertionError("should not download when the model is cached")

    monkeypatch.setattr(pm, "_download", fail_download)
    assert pm.ensure_model(1, cache_dir=tmp_path) == cached


def test_ensure_model_downloads_when_missing(tmp_path, monkeypatch):
    def fake_download(url, dest):
        assert "pose_landmarker_lite" in url
        dest.write_bytes(b"model")

    monkeypatch.setattr(pm, "_download", fake_download)
    path = pm.ensure_model(0, cache_dir=tmp_path)
    assert path == tmp_path / "pose_landmarker_lite.task"
    assert path.read_bytes() == b"model"
    assert list(tmp_path.glob("*.part")) == []


def test_ensure_model_failed_download_raises_and_leaves_no_partial_file(tmp_path, monkeypatch):
    def broken_download(url, dest):
        dest.write_bytes(b"half a mod")
        raise OSError("network unreachable")

    monkeypatch.setattr(pm, "_download", broken_download)
    with pytest.raises(pm.ModelDownloadError):
        pm.ensure_model(1, cache_dir=tmp_path)
    assert list(tmp_path.iterdir()) == []
