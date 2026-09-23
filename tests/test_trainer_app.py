import sys

import pytest

import trainer_app
from exercises import EXERCISES


def test_main_exits_cleanly_for_unopenable_video_source(tmp_path, monkeypatch, capsys):
    bad_path = str(tmp_path / "does_not_exist.mp4")
    monkeypatch.setattr(sys, "argv", ["trainer_app.py", "--video", bad_path])

    with pytest.raises(SystemExit) as exc_info:
        trainer_app.main()

    assert exc_info.value.code == 1
    assert f"could not open video source {bad_path!r}" in capsys.readouterr().err


def test_parse_args_defaults():
    args = trainer_app.parse_args([])
    assert args.camera == 0
    assert args.video is None
    assert args.exercise == "bicep_curl"
    assert args.angle_range is None
    assert args.golden_rep_path is None


def test_parse_args_accepts_known_exercise():
    args = trainer_app.parse_args(["--exercise", "squat"])
    assert args.exercise == "squat"


def test_parse_args_rejects_unknown_exercise(capsys):
    with pytest.raises(SystemExit):
        trainer_app.parse_args(["--exercise", "deadlift"])


def test_resolve_angle_range_uses_exercise_default_when_not_overridden():
    exercise = EXERCISES["bicep_curl"]
    assert trainer_app.resolve_angle_range(exercise, None) == exercise.angle_range


def test_resolve_angle_range_override_wins():
    exercise = EXERCISES["bicep_curl"]
    assert trainer_app.resolve_angle_range(exercise, [1.0, 2.0]) == (1.0, 2.0)


def test_resolve_golden_rep_path_defaults_per_exercise():
    exercise = EXERCISES["squat"]
    assert trainer_app.resolve_golden_rep_path(exercise, None) == "golden_reps/squat.npy"


def test_resolve_golden_rep_path_override_wins():
    exercise = EXERCISES["bicep_curl"]
    assert trainer_app.resolve_golden_rep_path(exercise, "custom.npy") == "custom.npy"
