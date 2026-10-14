import { describe, expect, it } from "vitest";
import { EXERCISES, SIDES, calibrateRange, type AngleRange, type Side } from "./exercises";
import leftFixture from "./fixtures/curl-side-left-mirrored.json";
import rightFixture from "./fixtures/curl-side-right.json";
import { repDistance, type Frame } from "./formScoring";
import { playback, recordFrame, type LandmarkRecording } from "./recording";
import { DEFAULT_TRACKING_CONFIG, MotionTracker, type PoseInput, type SideSnapshot } from "./tracking";

const curl = EXERCISES.bicep_curl;
const FRAME_MS = 33;
const SQUARE = { width: 1000, height: 1000 };

interface Run {
  last: Record<Side, SideSnapshot>;
  reps: Record<Side, Frame[][]>;
  /** Every snapshot, per side, in order. */
  history: Record<Side, SideSnapshot[]>;
  endMs: number;
}

/** Feeds poses through a tracker one frame at a time and collects what comes out. */
function feed(tracker: MotionTracker, frames: { t: number; pose: PoseInput | null }[], size = SQUARE, startMs = 0): Run {
  const run: Run = { last: undefined!, reps: { left: [], right: [] }, history: { left: [], right: [] }, endMs: startMs };
  for (const { t, pose } of frames) {
    run.endMs = startMs + t;
    run.last = tracker.update(pose, run.endMs, size);
    for (const side of SIDES) {
      run.history[side].push(run.last[side]);
      if (run.last[side].completedRep) run.reps[side].push(run.last[side].completedRep!);
    }
  }
  return run;
}

// ---------------------------------------------------------------------------------------------
// Real landmarks: videos/IMG_5970.mov, a seated dumbbell curl filmed from the person's right side
// (right arm in view, left arm hidden behind the body), and the same video mirrored, which the
// pose model reads as a left-arm curl. Extracted by scripts/extract_landmarks.py.
// ---------------------------------------------------------------------------------------------

const recordings: Record<Side, LandmarkRecording> = { right: rightFixture, left: leftFixture };
const other = (side: Side): Side => (side === "left" ? "right" : "left");
const replay = (side: Side, tracker = new MotionTracker(curl), startMs = 0) =>
  feed(tracker, playback(recordings[side]), recordings[side], startMs);

describe.each(SIDES)("recorded side-on curl, %s arm in view", (side) => {
  it("counts exactly one rep on the arm in view", () => {
    expect(replay(side).last[side].count).toBe(1);
  });

  it("never counts or moves the hidden arm, though the model's guess for it moves like a rep", () => {
    const { history, last } = replay(side);
    const hidden = history[other(side)];
    // The guessed angle sweeps through most of a curl...
    const guessed = hidden.map((snap) => snap.rawAngle!);
    expect(Math.max(...guessed) - Math.min(...guessed)).toBeGreaterThan(60);
    // ...but none of it is used.
    expect(hidden.some((snap) => snap.visible || snap.updated)).toBe(false);
    expect(last[other(side)].count).toBe(0);
    expect(last[other(side)].percent).toBe(0);
  });

  it("fills the bar and returns it to empty", () => {
    const percents = replay(side).history[side].map((snap) => snap.percent);
    expect(Math.max(...percents)).toBe(100);
    expect(percents.at(-1)).toBe(0);
  });

  it("smooths the angle without losing the top of the rep", () => {
    const { history } = replay(side);
    const used = history[side].filter((snap) => snap.updated);
    const raw = used.map((snap) => snap.rawAngle!);
    const smoothed = used.map((snap) => snap.angle!);
    // Fast jitter: how far each value sits from the average of its neighbours (RMS over the clip).
    const jitter = (values: number[]) => {
      const deviations = values.slice(3, -3).map((value, i) => value - values.slice(i, i + 7).reduce((sum, v) => sum + v, 0) / 7);
      return Math.sqrt(deviations.reduce((sum, d) => sum + d * d, 0) / deviations.length);
    };
    // The pose model already smooths its output, so there is only about 1.5 degrees to remove; the filter halves it.
    expect(jitter(raw)).toBeLessThan(2.5);
    expect(jitter(smoothed)).toBeLessThan(jitter(raw) * 0.6);
    expect(Math.abs(Math.min(...smoothed) - Math.min(...raw))).toBeLessThan(3);
  });

  it("still counts when the top of the range is slightly out of reach", () => {
    // The bug: with the top a few degrees beyond what the arm reaches, the bar stalled around
    // 90-95% and, needing exactly 100%, the rep never counted.
    const reached = Math.min(...replay(side).history[side].filter((snap) => snap.updated).map((snap) => snap.angle!));
    const tracker = new MotionTracker(curl);
    tracker.setRange(side, [150, reached - 6]);
    const { last, history } = replay(side, tracker);
    const peak = Math.max(...history[side].map((snap) => snap.percent));
    expect(peak).toBeLessThan(100);
    expect(peak).toBeGreaterThan(85);
    expect(last[side].count).toBe(1);
  });

  it("returns the completed rep for form scoring, and a replay scores as a close match", () => {
    const tracker = new MotionTracker(curl);
    const first = replay(side, tracker);
    const second = replay(side, tracker, first.endMs + 2000);
    expect(first.reps[side]).toHaveLength(1);
    expect(second.reps[side]).toHaveLength(1);
    expect(first.reps[side][0].length).toBeGreaterThan(60);
    expect(first.reps[side][0][0]).toHaveLength(6);
    expect(repDistance(first.reps[side][0], second.reps[side][0])).toBeLessThan(0.05);
  });
});

describe("the two recorded arms together", () => {
  const calibrated = (side: Side): AngleRange => {
    const angles = replay(side)
      .history[side].filter((snap) => snap.updated)
      .map((snap) => snap.angle!);
    return calibrateRange(curl.angleRange, angles)!;
  };

  it("the pose model reads the same movement differently on each side", () => {
    // Same video, mirrored: a real curl is identical, yet the top reads about 10 degrees apart.
    expect(calibrated("left")[1] - calibrated("right")[1]).toBeGreaterThan(5);
  });

  it("each side fills its own bar once calibrated, where a shared strict range fills only one", () => {
    // A shared range tuned to the right arm leaves the left arm short of full.
    const shared = calibrated("right");
    const sharedTracker = new MotionTracker(curl);
    sharedTracker.setRange("left", shared);
    const leftOnShared = Math.max(...replay("left", sharedTracker).history.left.map((snap) => snap.percent));
    expect(leftOnShared).toBeLessThan(95);

    for (const side of SIDES) {
      const tracker = new MotionTracker(curl);
      tracker.setRange(side, calibrated(side));
      const { last, history } = replay(side, tracker);
      expect(last[side].calibrated).toBe(true);
      expect(Math.max(...history[side].map((snap) => snap.percent))).toBeGreaterThan(97);
      expect(last[side].count).toBe(1);
    }
  });

  it("after calibrating, still counts a rep that starts moments after the arm comes into view", () => {
    for (const side of SIDES) {
      const tracker = new MotionTracker(curl);
      tracker.setRange(side, calibrated(side));
      const lateStart = { ...recordings[side], frames: recordings[side].frames.slice(8) };
      expect(feed(tracker, playback(lateStart), lateStart).last[side].count).toBe(1);
    }
  });

  it("rejects a calibration window that caught only part of a rep", () => {
    for (const side of SIDES) {
      const angles = replay(side)
        .history[side].filter((snap) => snap.updated)
        .map((snap) => snap.angle!);
      const top = angles.indexOf(Math.min(...angles));
      expect(calibrateRange(curl.angleRange, angles.slice(top))).toBeNull(); // only the way down
      expect(calibrateRange(curl.angleRange, angles.slice(0, top - 10))).toBeNull(); // only the way up
    }
  });

  it("scores the mirrored arm against the other arm's golden rep as a close match", () => {
    const golden = replay("right").reps.right[0];
    const leftRep = replay("left").reps.left[0];
    expect(repDistance(golden, leftRep)).toBeLessThan(0.12);
  });
});

// ---------------------------------------------------------------------------------------------
// Synthetic poses, for situations there is no footage of.
// ---------------------------------------------------------------------------------------------

interface ArmSpec {
  /** True elbow angle in degrees. */
  angle: number;
  visibility?: number;
  /** "side": the forearm swings in the image plane. "front": it swings toward the camera. */
  view?: "side" | "front";
}

interface SyntheticPose {
  image: { x: number; y: number; visibility: number }[];
  world: { x: number; y: number; z: number }[];
}

/** A pose with each arm at the given elbow angle. World and image coordinates share one scale. */
function pose(arms: Record<Side, ArmSpec>): SyntheticPose {
  const result: SyntheticPose = { image: [], world: [] };
  const put = (id: number, x: number, y: number, z: number, visibility: number) => {
    result.image[id] = { x, y, visibility };
    result.world[id] = { x, y, z };
  };
  for (const side of SIDES) {
    const { angle, visibility = 0.95, view = "side" } = arms[side];
    const [shoulder, elbow, wrist] = curl.joints[side];
    const x = side === "left" ? 0.6 : 0.4;
    const radians = (angle * Math.PI) / 180;
    // The upper arm hangs straight down; the forearm makes `angle` with it.
    const reach = 0.2 * Math.sin(radians);
    put(shoulder, x, 0.3, 0, visibility);
    put(elbow, x, 0.5, 0, visibility);
    put(wrist, x + (view === "side" ? reach : 0), 0.5 - 0.2 * Math.cos(radians), view === "front" ? -reach : 0, visibility);
    put(side === "left" ? 23 : 24, x, 0.8, 0, 0.95);
  }
  return result;
}

/** Elbow angle over one rep: `rest` -> `top` -> `rest`, lasting `frames` frames. */
const sweep = (rest: number, top: number, frames = 60) =>
  Array.from({ length: frames }, (_, i) => (rest + top) / 2 + ((rest - top) / 2) * Math.cos((i / (frames - 1)) * 2 * Math.PI));
const hold = (angle: number, frames: number) => new Array<number>(frames).fill(angle);

/** Builds a frame sequence from per-frame arm specs. */
function sequence(length: number, arms: (i: number) => Record<Side, ArmSpec>, startMs = 0) {
  return Array.from({ length }, (_, i) => ({ t: startMs + i * FRAME_MS, pose: pose(arms(i)) }));
}

describe("asymmetric ranges", () => {
  // The same real curl, read by the camera as 172->55 on the left and 165->96 on the right.
  const left = [...hold(172, 10), ...sweep(172, 55), ...hold(172, 10), ...sweep(172, 55), ...hold(172, 10)];
  const right = [...hold(165, 10), ...sweep(165, 96), ...hold(165, 10), ...sweep(165, 96), ...hold(165, 10)];
  const frames = sequence(left.length, (i) => ({ left: { angle: left[i] }, right: { angle: right[i] } }));

  it("counts both arms even before calibration", () => {
    const { last } = feed(new MotionTracker(curl), frames);
    expect(last.left.count).toBe(2);
    expect(last.right.count).toBe(2);
  });

  it("before calibration the left bar fills early and the right bar stalls short of full", () => {
    const { history } = feed(new MotionTracker(curl), frames);
    const halfway = 10 + 15; // a quarter of the way through the first rep's cycle = halfway up
    expect(history.left[halfway].percent).toBeGreaterThan(history.right[halfway].percent + 15);
    expect(Math.max(...history.right.map((snap) => snap.percent))).toBeLessThan(95);
  });

  it("after calibration both bars track together and both reach full", () => {
    const first = feed(new MotionTracker(curl), frames);
    const tracker = new MotionTracker(curl);
    for (const side of SIDES) {
      const angles = first.history[side].filter((snap) => snap.updated).map((snap) => snap.angle!);
      tracker.setRange(side, calibrateRange(curl.angleRange, angles));
    }
    const { history, last } = feed(tracker, frames);
    for (let i = 12; i < frames.length; i += 5) {
      expect(Math.abs(history.left[i].percent - history.right[i].percent)).toBeLessThan(12);
    }
    for (const side of SIDES) {
      expect(Math.max(...history[side].map((snap) => snap.percent))).toBeGreaterThan(97);
      expect(last[side].count).toBe(2);
    }
  });
});

describe("an arm that hangs short of its most extended reading", () => {
  // Found in the browser: during calibration the arm read out to about 173 degrees for a moment,
  // but it normally hangs at about 154. Calibration first took the most extended reading as "rest";
  // with a 15% rest band the hanging arm then never registered as resting, sat "unready" through
  // every curl, and no rep counted.
  const hang = (i: number) => 154 + 2 * Math.sin(i * 1.7);
  const stretch = (i: number) => (i >= 10 && i < 22 ? 173 : hang(i)); // a brief full extension
  const calibration = [...Array.from({ length: 45 }, (_, i) => stretch(i)), ...sweep(154, 63), ...Array.from({ length: 45 }, (_, i) => hang(i))];
  const smoothed = feed(new MotionTracker(curl), sequence(calibration.length, (i) => ({ left: { angle: calibration[i] }, right: { angle: 170 } })))
    .history.left.filter((snap) => snap.updated)
    .map((snap) => snap.angle!);

  const oneRep = [...Array.from({ length: 30 }, (_, i) => hang(i)), ...sweep(154, 63), ...Array.from({ length: 30 }, (_, i) => hang(i))];
  const session = [...oneRep, ...oneRep, ...oneRep];
  const frames = sequence(session.length, (i) => ({ left: { angle: session[i] }, right: { angle: 170 } }));

  it("is missed with rest at the extreme and a narrow rest band", () => {
    expect(Math.max(...smoothed)).toBeGreaterThan(170);
    const old = new MotionTracker(curl, { ...DEFAULT_TRACKING_CONFIG, rep: { ...DEFAULT_TRACKING_CONFIG.rep, restPercent: 15 } });
    old.setRange("left", [Math.max(...smoothed), Math.min(...smoothed)]);
    const { last, history } = feed(old, frames);
    expect(last.left.count).toBe(0);
    expect(history.left.every((snap) => snap.phase === "unready")).toBe(true);
  });

  it("is counted with the calibrated range and default settings", () => {
    const range = calibrateRange(curl.angleRange, smoothed)!;
    // Rest lands where the arm hangs, not at the brief full extension.
    expect(range[0]).toBeLessThan(160);
    const tracker = new MotionTracker(curl);
    tracker.setRange("left", range);
    expect(feed(tracker, frames).last.left.count).toBe(3);
  });
});

describe("front view, forearm swinging toward the camera", () => {
  const angles = [...hold(170, 10), ...sweep(170, 50), ...hold(170, 10)];
  const frames = sequence(angles.length, (i) => ({ left: { angle: angles[i], view: "front" }, right: { angle: angles[i], view: "front" } }));

  it("the flat-image angle collapses while the 3D angle follows the real one", () => {
    const { history } = feed(new MotionTracker(curl), frames);
    // Forearm level and pointing at the camera: a true 90 degrees.
    const level = history.left.findIndex((snap) => Math.abs(snap.rawAngle! - 90) < 3);
    expect(level).toBeGreaterThan(0);
    // In the image the wrist sits on the elbow, so the 2D angle is meaningless there...
    expect(Math.abs(history.left[level].angle2d! - 90)).toBeGreaterThan(60);
    // ...and just past level it snaps to fully closed.
    const past = history.left.find((snap) => snap.rawAngle! < 80)!;
    expect(past.angle2d).toBeLessThan(5);
  });

  it("counts the rep from the 3D angle", () => {
    const { last } = feed(new MotionTracker(curl), frames);
    expect(last.left.count).toBe(1);
    expect(last.right.count).toBe(1);
  });
});

describe("occlusion", () => {
  const rest = hold(170, 10);
  const curlUp = sweep(170, 55);

  it("does not use low-confidence frames, and freezes the bar instead of following a garbage angle", () => {
    // The right wrist is covered for half a second on the way up; the model reports a wild angle with low visibility.
    const angles = [...rest, ...curlUp, ...rest];
    const covered = (i: number) => i >= 20 && i < 35;
    const frames = sequence(angles.length, (i) => ({
      left: { angle: angles[i] },
      right: covered(i) ? { angle: 10, visibility: 0.15 } : { angle: angles[i] },
    }));
    const { history, last } = feed(new MotionTracker(curl), frames);

    const during = history.right.slice(20, 35);
    expect(during.some((snap) => snap.updated)).toBe(false);
    // Frozen at the value from just before the wrist was covered, not jumping to the garbage angle's 100%.
    during.forEach((snap) => expect(snap.percent).toBe(history.right[19].percent));
    expect(history.right[19].percent).toBeLessThan(60);
    // Marked not visible once the low visibility has lasted a few frames.
    expect(during.at(-1)!.visible).toBe(false);
    // A dropout shorter than the grace period doesn't cost the rep, and the other arm is unaffected.
    expect(last.right.count).toBe(1);
    expect(last.left.count).toBe(1);
  });

  it("drops a rep whose limb stays hidden too long, and needs rest before counting again", () => {
    const angles = [...rest, ...curlUp, ...rest, ...curlUp, ...rest];
    // Hidden from partway up the first rep for 1.5 s, reappearing while the arm is still coming down.
    const covered = (i: number) => i >= 20 && i < 20 + 45;
    const frames = sequence(angles.length, (i) => ({
      left: { angle: angles[i] },
      right: { angle: angles[i], visibility: covered(i) ? 0.1 : 0.95 },
    }));
    const { last } = feed(new MotionTracker(curl), frames);
    expect(last.left.count).toBe(2);
    // The first rep was abandoned; only the second, started from rest in full view, counts.
    expect(last.right.count).toBe(1);
  });

  it("never counts a side that stays hidden, even if its guessed angle does full reps", () => {
    const angles = [...rest, ...curlUp, ...rest, ...curlUp, ...rest];
    const frames = sequence(angles.length, (i) => ({ left: { angle: angles[i] }, right: { angle: angles[i], visibility: 0.1 } }));
    const { last, history } = feed(new MotionTracker(curl), frames);
    expect(last.left.count).toBe(2);
    expect(last.right.count).toBe(0);
    expect(last.right.visible).toBe(false);
    expect(history.right.every((snap) => snap.percent === 0)).toBe(true);
  });

  it("does not let visibility flickering around the threshold produce counts", () => {
    const angles = [...rest, ...curlUp, ...rest, ...curlUp, ...rest];
    const frames = sequence(angles.length, (i) => ({
      left: { angle: angles[i] },
      right: { angle: angles[i], visibility: i % 2 ? 0.58 : 0.42 },
    }));
    const { last, history } = feed(new MotionTracker(curl), frames);
    expect(history.right.some((snap) => snap.visible)).toBe(false);
    expect(last.right.count).toBe(0);
  });

  it("does not count a landmark that jumps for one frame", () => {
    // At rest, the wrist landmark jumps to a fully curled position for a single frame, twice.
    const angles = hold(170, 60);
    angles[20] = 40;
    angles[40] = 40;
    const frames = sequence(angles.length, (i) => ({ left: { angle: angles[i] }, right: { angle: 170 } }));
    const { last, history } = feed(new MotionTracker(curl), frames);
    expect(last.left.count).toBe(0);
    expect(history.left.every((snap) => snap.phase !== "peaked")).toBe(true);
  });

  it("holds everything when no one is in view", () => {
    const tracker = new MotionTracker(curl);
    const before = feed(tracker, sequence(20, () => ({ left: { angle: 120 }, right: { angle: 120 } })));
    const gone = Array.from({ length: 10 }, (_, i) => ({ t: before.endMs + (i + 1) * FRAME_MS, pose: null }));
    const { last } = feed(tracker, gone);
    for (const side of SIDES) {
      expect(last[side].visible).toBe(false);
      expect(last[side].updated).toBe(false);
      expect(last[side].jointVisibility).toBeNull();
      expect(last[side].rawAngle).toBeNull();
      expect(last[side].percent).toBe(before.last[side].percent);
    }
  });
});

describe("configuration and ranges", () => {
  it("starts on the exercise's default range and reports calibration", () => {
    const tracker = new MotionTracker(curl);
    const frame = sequence(1, () => ({ left: { angle: 170 }, right: { angle: 170 } }));
    expect(feed(tracker, frame).last.left).toMatchObject({ range: curl.angleRange, calibrated: false });
    tracker.setRange("left", [168, 70]);
    const { last } = feed(tracker, frame, SQUARE, 100);
    expect(last.left).toMatchObject({ range: [168, 70], calibrated: true });
    expect(last.right.calibrated).toBe(false);
    tracker.setRange("left", null);
    expect(feed(tracker, frame, SQUARE, 200).last.left.calibrated).toBe(false);
  });

  it("changing a range mid-rep abandons that rep", () => {
    const tracker = new MotionTracker(curl);
    const up = [...hold(170, 10), ...sweep(170, 55).slice(0, 30)];
    const first = feed(tracker, sequence(up.length, (i) => ({ left: { angle: up[i] }, right: { angle: 170 } })));
    expect(first.last.left.phase).toBe("peaked");
    tracker.setRange("left", [170, 60]);
    const down = [...sweep(170, 55).slice(30), ...hold(170, 10)];
    const { last } = feed(tracker, sequence(down.length, (i) => ({ left: { angle: down[i] }, right: { angle: 170 } }), first.endMs + FRAME_MS));
    expect(last.left.count).toBe(0);
  });

  it("uses the visibility thresholds it documents", () => {
    expect(DEFAULT_TRACKING_CONFIG.visibilityEnter).toBeGreaterThan(DEFAULT_TRACKING_CONFIG.visibilityExit);
  });
});

describe("landmark recordings", () => {
  it("round-trip through the recording format", () => {
    const original = pose({ left: { angle: 123.4567 }, right: { angle: 77.7, visibility: 0.3333 } });
    const recording: LandmarkRecording = {
      source: "test",
      mirrored: false,
      width: 1000,
      height: 1000,
      landmarkIds: [11, 12, 13, 14, 15, 16, 23, 24],
      frames: [],
    };
    // recordFrame writes the app's full landmark list; this pose only has the arm and hip landmarks.
    const full = pose({ left: { angle: 123.4567 }, right: { angle: 77.7, visibility: 0.3333 } });
    for (const id of [25, 26, 27, 28]) {
      full.image[id] = { x: 0.5, y: 0.9, visibility: 0.9 };
      full.world[id] = { x: 0, y: 0.4, z: 0 };
    }
    const frame = recordFrame(full, 12.345);
    const [{ t, pose: restored }] = playback({ ...recording, landmarkIds: [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28], frames: [frame, recordFrame(null, 50)] });
    expect(t).toBe(12.3);
    for (const id of [11, 12, 13, 14, 15, 16]) {
      expect(restored!.image[id].x).toBeCloseTo(original.image[id].x, 3);
      expect(restored!.image[id].visibility).toBeCloseTo(original.image[id].visibility!, 2);
      expect(restored!.world[id].z).toBeCloseTo(original.world[id].z, 3);
    }
  });

  it("keeps frames with no one in view", () => {
    expect(recordFrame(null, 50)).toEqual({ t: 50, image: null, world: null });
    const [{ pose: restored }] = playback({ source: "test", mirrored: false, width: 1, height: 1, landmarkIds: [11], frames: [recordFrame(null, 50)] });
    expect(restored).toBeNull();
  });
});
