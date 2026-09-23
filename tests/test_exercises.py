from dataclasses import FrozenInstanceError

import pytest

from exercises import EXERCISES, Exercise


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
    assert exercise.angle_range[0] < exercise.angle_range[1]


def test_exercises_are_immutable():
    exercise = EXERCISES["bicep_curl"]
    with pytest.raises(FrozenInstanceError):
        exercise.name = "renamed"
