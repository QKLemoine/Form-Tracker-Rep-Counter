import { describe, expect, it } from "vitest";
import rightFixture from "./fixtures/curl-side-right.json";
import pythonTrack from "./fixtures/curl-side-right.posetrack.json";
import {
  ANGLES,
  ANGLE_JOINTS,
  JOINTS,
  MEDIAPIPE_IMAGE_UP,
  angleConfidence,
  computeAngles,
  frameFromPose,
  fromRecording,
  observedFrame,
  type PoseTrack,
  type Vec3,
} from "./poseTrack";
import { playback, type LandmarkRecording } from "./recording";

const recording = rightFixture as LandmarkRecording;

/** A person standing straight, arms hanging, in MediaPipe's world frame (y down). */
function uprightPose(): Vec3[] {
  const p: Record<string, Vec3> = {
    l_shoulder: [0.2, -0.5, 0], r_shoulder: [-0.2, -0.5, 0],
    l_elbow: [0.2, -0.2, 0], r_elbow: [-0.2, -0.2, 0],
    l_wrist: [0.2, 0.1, 0], r_wrist: [-0.2, 0.1, 0],
    l_hip: [0.1, 0, 0], r_hip: [-0.1, 0, 0],
    l_knee: [0.1, 0.45, 0], r_knee: [-0.1, 0.45, 0],
    l_ankle: [0.1, 0.9, 0], r_ankle: [-0.1, 0.9, 0],
  };
  return JOINTS.map((joint) => p[joint]);
}

describe("PoseTrack matches the Python implementation", () => {
  // fixtures/curl-side-right.posetrack.json is written by src/posetrack.py from the same recording.
  // Positions and confidences are copied, so they must match exactly; angles are computed on both
  // sides and rounded to 0.01 degrees, so they may differ by one rounding step.
  const ANGLE_TOLERANCE = 0.011;
  const ours = fromRecording(recording, "mediapipe-pose-full", "bicep_curl");
  const theirs = pythonTrack as unknown as PoseTrack;

  it("has the same header", () => {
    const { frames: _a, ...ourHeader } = ours;
    const { frames: _b, ...theirHeader } = theirs;
    expect(ourHeader).toEqual(theirHeader);
  });

  it("has the same positions, confidences and origins in every frame", () => {
    expect(ours.frames.length).toBe(theirs.frames.length);
    ours.frames.forEach((frame, i) => {
      expect(frame.t).toBe(theirs.frames[i].t);
      expect(frame.positions).toEqual(theirs.frames[i].positions);
      expect(frame.confidence).toEqual(theirs.frames[i].confidence);
      expect(frame.origin).toEqual(theirs.frames[i].origin);
    });
  });

  it("has the same angles in every frame, within one rounding step", () => {
    let worst = 0;
    ours.frames.forEach((frame, i) => {
      for (const name of ANGLES) worst = Math.max(worst, Math.abs(frame.angles[name]! - theirs.frames[i].angles[name]!));
    });
    expect(worst).toBeLessThanOrEqual(ANGLE_TOLERANCE);
  });
});

describe("computeAngles", () => {
  it("reads a straight, upright pose as straight joints and no lean", () => {
    const angles = computeAngles(uprightPose(), MEDIAPIPE_IMAGE_UP);
    expect(angles.l_elbow).toBeCloseTo(180);
    expect(angles.r_knee).toBeCloseTo(180);
    expect(angles.trunk_lean).toBeCloseTo(0);
  });

  it("measures trunk lean against the given up vector", () => {
    const pose = uprightPose();
    expect(computeAngles(pose, [1, 0, 0]).trunk_lean).toBeCloseTo(90);
    expect(computeAngles(pose, [Math.SQRT1_2, -Math.SQRT1_2, 0]).trunk_lean).toBeCloseTo(45);
  });

  it("reads a forward and a backward lean the same: trunk lean is unsigned", () => {
    const shift = (dz: number) => uprightPose().map(([x, y, z]) => [x, y, y < -0.4 ? z + dz : z] as Vec3);
    const forward = computeAngles(shift(-0.5), MEDIAPIPE_IMAGE_UP).trunk_lean;
    expect(forward).toBeGreaterThan(30);
    expect(computeAngles(shift(0.5), MEDIAPIPE_IMAGE_UP).trunk_lean).toBeCloseTo(forward);
  });
});

describe("angleConfidence", () => {
  it("is the least confident of the angle's joints, all four for trunk lean", () => {
    const confidence = JOINTS.map(() => 0.9);
    confidence[JOINTS.indexOf("l_shoulder")] = 0.3;
    const frame = observedFrame(0, uprightPose(), confidence, MEDIAPIPE_IMAGE_UP);
    expect(angleConfidence(frame, "r_elbow")).toBe(0.9);
    expect(angleConfidence(frame, "l_elbow")).toBe(0.3);
    expect(angleConfidence(frame, "trunk_lean")).toBe(0.3);
    expect(ANGLE_JOINTS.trunk_lean).toEqual(["l_shoulder", "r_shoulder", "l_hip", "r_hip"]);
  });
});

describe("frameFromPose", () => {
  it("gives the same frames live as converting a recording of the same poses", () => {
    const converted = fromRecording(recording, "mediapipe-pose-full", "bicep_curl").frames;
    playback(recording).forEach(({ t, pose }, i) => expect(frameFromPose(pose, t)).toEqual(converted[i]));
  });

  it("leaves everything empty when no one is in view", () => {
    const frame = frameFromPose(null, 10);
    expect(frame.positions).toBeNull();
    expect(frame.confidence).toBeNull();
    for (const name of ANGLES) {
      expect(frame.angles[name]).toBeNull();
      expect(frame.origin[name]).toBeNull();
    }
    expect(angleConfidence(frame, "l_elbow")).toBeNull();
  });
});
