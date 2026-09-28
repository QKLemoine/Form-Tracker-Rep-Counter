from dataclasses import FrozenInstanceError

import pytest

from src.exercises import EXERCISES, Exercise, angle_to_percent


def test_registry_is_nonempty():
    assert len(EXERCISES) > 0


def test_bicep_curl_is_registered():
    assert "bicep_curl" in EXERCISES


@pytest.mark.parametrize("key", list(EXERCISES))
def test_exercise_entries_are_well_formed(key):
    exercise = EXERCISES[key]
    assert isinstance(exercise, Exercise)
    assert exercise.name == key
    assert exercise.label
    assert len(exercise.joints) == 3
    assert all(isinstance(j, int) and j >= 0 for j in exercise.joints)
    assert len(exercise.angle_range) == 2
    start, end = exercise.angle_range
    assert 0 <= start <= 180 and 0 <= end <= 180
    assert start != end


def test_exercises_are_immutable():
    exercise = EXERCISES["bicep_curl"]
    with pytest.raises(FrozenInstanceError):
        exercise.name = "renamed"


def test_angle_to_percent_ascending_range():
    assert angle_to_percent(90, (60, 120)) == 50.0


def test_angle_to_percent_descending_range():
    # A curl closes the elbow: 150 is rest (0%), 50 is the peak (100%).
    assert angle_to_percent(150, (150, 50)) == 0.0
    assert angle_to_percent(100, (150, 50)) == 50.0
    assert angle_to_percent(50, (150, 50)) == 100.0


@pytest.mark.parametrize("angle_range", [(150, 50), (50, 150)])
def test_angle_to_percent_clips_to_exact_endpoints(angle_range):
    # RepTracker compares against exactly 0 and 100, so clipping must land on them.
    beyond_start = angle_range[0] + (10 if angle_range[0] > angle_range[1] else -10)
    beyond_end = angle_range[1] + (-10 if angle_range[0] > angle_range[1] else 10)
    assert angle_to_percent(beyond_start, angle_range) == 0
    assert angle_to_percent(beyond_end, angle_range) == 100
