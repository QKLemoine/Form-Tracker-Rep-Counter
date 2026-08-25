class RepTracker:
    """Tracks rep count and golden/live rep buffers from a stream of per-frame
    joint-angle percentages, independent of any camera or drawing code."""

    def __init__(self, evaluator):
        self.evaluator = evaluator

        self.count = 0
        self.dir = 0

        self.is_recording_golden = False
        self.golden_rep_saved = False
        self.golden_rep_frames = []
        self.live_rep_frames = []
        self.last_score = 0.0

    def toggle_golden_recording(self):
        """Flip golden-rep recording. Locks in the recorded frames as the
        golden rep once recording stops. Returns the new recording state."""
        self.is_recording_golden = not self.is_recording_golden

        if not self.is_recording_golden and len(self.golden_rep_frames) > 0:
            self.golden_rep_saved = True
            self.live_rep_frames = []

        return self.is_recording_golden

    def update(self, per, frame_coords):
        """Advance the state machine by one frame.

        per: percent-through-rep (0-100) derived from the tracked joint angle.
        frame_coords: (num_joints, 2) array of this frame's joint coordinates.
        """
        if self.is_recording_golden:
            self.golden_rep_frames.append(frame_coords)
        elif self.golden_rep_saved and (per > 0 or self.dir == 1):
            self.live_rep_frames.append(frame_coords)

        if per == 100 and self.dir == 0:
            self.count += 0.5
            self.dir = 1

        if per == 0 and self.dir == 1:
            self.count += 0.5
            self.dir = 0

            if self.golden_rep_saved and len(self.live_rep_frames) > 0:
                score, _path = self.evaluator.evaluate_rep(
                    self.golden_rep_frames, self.live_rep_frames
                )
                self.last_score = score
                self.live_rep_frames = []
