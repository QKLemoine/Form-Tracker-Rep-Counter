import numpy as np
import pytest

from analytics.form_scoring import FormEvaluator

NUM_JOINTS = 33  # MediaPipe Pose landmark count
ROOT_IDX = 23     # left hip
SHOULDER_IDX = 11  # left shoulder

# A fixed "body shape": every joint's offset from the hip. Root is at the
# origin and the shoulder sits 2 units above it; the rest is arbitrary but
# deterministic filler so every joint moves together as a rigid body.
_BASE_OFFSETS = np.stack(
    [np.arange(NUM_JOINTS) * 0.3 - 5.0, np.arange(NUM_JOINTS) * 0.2 - 3.0], axis=1
)
_BASE_OFFSETS[ROOT_IDX] = (0.0, 0.0)
_BASE_OFFSETS[SHOULDER_IDX] = (0.0, -2.0)


def make_frame(hip=(0.0, 0.0), scale=1.0, shoulder_sway=0.0):
    """Builds a single synthetic pose frame as a rigid-body transform (translate
    by `hip`, uniformly scale) of a fixed base shape, so hip/scale changes keep
    every joint consistent. `shoulder_sway` optionally displaces just the
    shoulder to simulate a form deviation that isn't a rigid transform."""
    frame = np.array(hip) + _BASE_OFFSETS * scale
    frame[SHOULDER_IDX, 0] += shoulder_sway
    return frame


@pytest.fixture
def evaluator():
    return FormEvaluator(root_idx=ROOT_IDX, shoulder_idx=SHOULDER_IDX)


def test_normalize_skeleton_centers_on_root(evaluator):
    frame = make_frame(hip=(5.0, 10.0))
    normalized = evaluator.normalize_skeleton(frame)
    assert normalized[ROOT_IDX] == pytest.approx([0.0, 0.0])


def test_normalize_skeleton_scales_by_torso_length(evaluator):
    frame = make_frame(hip=(5.0, 10.0), scale=2.0)
    normalized = evaluator.normalize_skeleton(frame)
    # Base torso length is 2; at scale=2 that's 4, so it should normalize to 1.
    assert np.linalg.norm(normalized[SHOULDER_IDX] - normalized[ROOT_IDX]) == pytest.approx(1.0)


def test_normalize_skeleton_handles_degenerate_torso(evaluator):
    # scale=0 collapses every joint onto the hip -> zero torso length; must
    # not divide by zero.
    frame = make_frame(hip=(1.0, 1.0), scale=0.0)
    normalized = evaluator.normalize_skeleton(frame)
    assert np.all(np.isfinite(normalized))


def test_evaluate_rep_identical_sequences_scores_near_zero(evaluator):
    rep = [make_frame(hip=(i, 0.0)) for i in range(5)]
    score, path = evaluator.evaluate_rep(rep, rep)
    assert score == pytest.approx(0.0, abs=1e-9)
    assert len(path) > 0


def test_evaluate_rep_is_translation_and_scale_invariant(evaluator):
    golden = [make_frame(hip=(i, 0.0), scale=1.0) for i in range(5)]
    # Same motion, shifted in space and at a different overall scale.
    shifted_scaled = [make_frame(hip=(i * 3 + 100, 50.0), scale=3.0) for i in range(5)]
    score, _ = evaluator.evaluate_rep(golden, shifted_scaled)
    assert score == pytest.approx(0.0, abs=1e-9)


def test_evaluate_rep_diverging_sequences_scores_higher_than_identical(evaluator):
    golden = [make_frame(hip=(i, 0.0)) for i in range(5)]
    identical_score, _ = evaluator.evaluate_rep(golden, golden)

    # Shoulder sways independently of the hip -> not a rigid-body match.
    sloppy = [make_frame(hip=(i, 0.0), shoulder_sway=i * 0.5) for i in range(5)]
    sloppy_score, _ = evaluator.evaluate_rep(golden, sloppy)

    assert sloppy_score > identical_score


def test_evaluate_rep_empty_input_returns_infinity(evaluator):
    score, path = evaluator.evaluate_rep([], [])
    assert score == float("inf")
    assert path == []
