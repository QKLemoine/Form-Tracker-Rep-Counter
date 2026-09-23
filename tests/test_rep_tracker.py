import numpy as np
import pytest

from analytics.rep_tracker import RepTracker


class FakeEvaluator:
    """Stub evaluator so RepTracker's state machine can be tested without
    pulling in the real DTW math."""

    def __init__(self, score=42.0):
        self.score = score
        self.calls = []

    def evaluate_rep(self, golden_rep, test_rep):
        self.calls.append((list(golden_rep), list(test_rep)))
        return self.score, [(0, 0)]


FRAME = np.zeros((33, 2))


@pytest.fixture
def evaluator():
    return FakeEvaluator()


@pytest.fixture
def tracker(evaluator):
    return RepTracker(evaluator)


def test_top_of_rep_adds_half_count(tracker):
    tracker.update(per=100, frame_coords=FRAME)
    assert tracker.count == 0.5
    assert tracker.dir == 1


def test_full_rep_adds_full_count(tracker):
    tracker.update(per=100, frame_coords=FRAME)
    tracker.update(per=0, frame_coords=FRAME)
    assert tracker.count == 1.0
    assert tracker.dir == 0


def test_repeated_top_without_bottom_does_not_double_count(tracker):
    tracker.update(per=100, frame_coords=FRAME)
    tracker.update(per=100, frame_coords=FRAME)
    assert tracker.count == 0.5


def test_golden_recording_buffers_frames_and_locks_on_stop(tracker):
    tracker.toggle_golden_recording()
    tracker.update(per=10, frame_coords=FRAME)
    tracker.update(per=20, frame_coords=FRAME)
    assert tracker.golden_rep_saved is False

    tracker.toggle_golden_recording()
    assert tracker.golden_rep_saved is True
    assert len(tracker.golden_rep_frames) == 2


def test_stopping_recording_with_no_frames_does_not_save(tracker):
    tracker.toggle_golden_recording()
    tracker.toggle_golden_recording()
    assert tracker.golden_rep_saved is False


def test_live_frames_only_buffered_after_golden_saved(tracker):
    tracker.update(per=50, frame_coords=FRAME)
    assert tracker.live_rep_frames == []

    tracker.toggle_golden_recording()
    tracker.update(per=10, frame_coords=FRAME)
    tracker.toggle_golden_recording()

    tracker.update(per=50, frame_coords=FRAME)
    assert len(tracker.live_rep_frames) == 1


def test_completing_a_rep_scores_against_golden_and_clears_buffer(tracker, evaluator):
    tracker.toggle_golden_recording()
    tracker.update(per=10, frame_coords=FRAME)
    tracker.toggle_golden_recording()

    tracker.update(per=50, frame_coords=FRAME)
    tracker.update(per=100, frame_coords=FRAME)
    tracker.update(per=0, frame_coords=FRAME)

    assert len(evaluator.calls) == 1
    assert tracker.last_score == 42.0
    assert tracker.live_rep_frames == []


def test_no_scoring_without_golden_rep(tracker, evaluator):
    tracker.update(per=100, frame_coords=FRAME)
    tracker.update(per=0, frame_coords=FRAME)
    assert len(evaluator.calls) == 0
    assert tracker.last_score == 0.0


def test_save_golden_rep_round_trips(tracker, evaluator, tmp_path):
    path = tmp_path / "golden_rep.npy"

    tracker.toggle_golden_recording()
    tracker.update(per=10, frame_coords=np.full((33, 2), 1.0))
    tracker.update(per=20, frame_coords=np.full((33, 2), 2.0))
    tracker.toggle_golden_recording()
    tracker.save_golden_rep(path)

    loaded = RepTracker(evaluator)
    assert loaded.load_golden_rep(path) is True
    assert loaded.golden_rep_saved is True
    assert len(loaded.golden_rep_frames) == 2
    np.testing.assert_array_equal(loaded.golden_rep_frames[0], np.full((33, 2), 1.0))
    np.testing.assert_array_equal(loaded.golden_rep_frames[1], np.full((33, 2), 2.0))


def test_save_golden_rep_is_a_noop_when_nothing_saved(tracker, tmp_path):
    path = tmp_path / "golden_rep.npy"
    tracker.save_golden_rep(path)
    assert not path.exists()


def test_load_golden_rep_missing_file_returns_false(tracker, tmp_path):
    path = tmp_path / "does_not_exist.npy"
    assert tracker.load_golden_rep(path) is False
    assert tracker.golden_rep_saved is False
    assert tracker.golden_rep_frames == []


def test_load_golden_rep_corrupt_file_returns_false(tracker, tmp_path):
    path = tmp_path / "corrupt.npy"
    path.write_bytes(b"not a valid npy file")

    assert tracker.load_golden_rep(path) is False
    assert tracker.golden_rep_saved is False
    assert tracker.golden_rep_frames == []


def test_load_golden_rep_does_not_clobber_existing_state_on_failure(tracker, tmp_path):
    tracker.toggle_golden_recording()
    tracker.update(per=10, frame_coords=FRAME)
    tracker.toggle_golden_recording()
    original_frames = tracker.golden_rep_frames

    path = tmp_path / "does_not_exist.npy"
    assert tracker.load_golden_rep(path) is False
    assert tracker.golden_rep_saved is True
    assert tracker.golden_rep_frames is original_frames
