import sys

import pytest

import trainer_app


def test_main_exits_cleanly_for_unopenable_video_source(tmp_path, monkeypatch, capsys):
    bad_path = str(tmp_path / "does_not_exist.mp4")
    monkeypatch.setattr(sys, "argv", ["trainer_app.py", "--video", bad_path])

    with pytest.raises(SystemExit) as exc_info:
        trainer_app.main()

    assert exc_info.value.code == 1
    assert f"could not open video source {bad_path!r}" in capsys.readouterr().err
