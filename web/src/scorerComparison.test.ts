// Both form scorers on the recorded fixtures, rep by rep: the angle scorer (default, golden reps v3)
// against the position scorer it replaces (?scorer=position, golden reps v2). Set SCORER_REPORT=1 to
// print the per-rep table:  SCORER_REPORT=1 npx vitest run src/scorerComparison.test.ts

import { describe, expect, it } from "vitest";
import { angleFrames, angleMatchPercent, angleRepDistance } from "./angleScoring";
import { DEFAULT_CALIBRATION_CONFIG } from "./calibration";
import { EXERCISES, SIDES, type Side } from "./exercises";
import frontFixture from "./fixtures/curl-front-screenrec.json";
import leftFixture from "./fixtures/curl-side-left-mirrored.json";
import rightFixture from "./fixtures/curl-side-right.json";
import { matchPercent, mostTypicalRep, repDistance, torsoSwing } from "./formScoring";
import { playback, type LandmarkRecording } from "./recording";
import { MotionTracker, type RepSample } from "./tracking";

const curl = EXERCISES.bicep_curl;
const report = Boolean((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SCORER_REPORT);

interface Rep {
  side: Side;
  /** When the rep ended, in seconds into the recording. */
  endS: number;
  samples: RepSample[];
}

/** Every rep the tracker completes on a recording, both sides, in the order they finish. */
function repsOf(recording: LandmarkRecording): Rep[] {
  const tracker = new MotionTracker(curl);
  const reps: Rep[] = [];
  for (const { t, pose } of playback(recording)) {
    const snaps = tracker.update(pose, t, recording);
    for (const side of SIDES) {
      const samples = snaps[side].completedRep;
      if (samples) reps.push({ side, endS: t / 1000, samples });
    }
  }
  return reps;
}

const positions = (rep: Rep) => rep.samples.map((s) => s.position);
const angles = (rep: Rep) => angleFrames(rep.samples.map((s) => s.pose), curl, rep.side);

/** Each scorer's golden rep as the app picks it: the most typical of the first three reps without a body swing. */
function goldens(reps: Rep[]): { angle: Rep; position: Rep } {
  const candidates = reps.filter((rep) => torsoSwing(positions(rep)) <= DEFAULT_CALIBRATION_CONFIG.maxTorsoSwingDegrees).slice(0, 3);
  return {
    angle: candidates[mostTypicalRep(candidates.map(angles), angleRepDistance)],
    position: candidates[mostTypicalRep(candidates.map(positions))],
  };
}

function score(golden: { angle: Rep; position: Rep }, rep: Rep) {
  const angle = angleRepDistance(angles(golden.angle), angles(rep));
  const position = repDistance(positions(golden.position), positions(rep));
  return { angle, anglePercent: angleMatchPercent(angle), position, positionPercent: matchPercent(position) };
}

/** The rep cut off halfway: only the frames below the midpoint of its elbow movement, so it never reaches the top. */
function halfRep(rep: Rep): Rep {
  const elbow = rep.samples.map((s) => s.pose.angles[rep.side === "left" ? "l_elbow" : "r_elbow"]!);
  const midpoint = (elbow[0] + Math.min(...elbow)) / 2;
  return { ...rep, samples: rep.samples.filter((_, i) => elbow[i] >= midpoint) };
}

const front = repsOf(frontFixture as LandmarkRecording);
// As the app does it: one golden rep from the first good reps, whichever arm they came from.
const frontGolden = goldens(front);
const frontScores = front.map((rep) => score(frontGolden, rep));
const halfScores = front.map((rep) => score(frontGolden, halfRep(rep)));
// For comparison: a golden rep per arm, each scored only against that arm's reps.
const ownGolden = { left: goldens(front.filter((rep) => rep.side === "left")), right: goldens(front.filter((rep) => rep.side === "right")) };
const ownScores = front.map((rep) => score(ownGolden[rep.side], rep));
const ownHalfScores = front.map((rep) => score(ownGolden[rep.side], halfRep(rep)));
const [sideRight] = repsOf(rightFixture as LandmarkRecording);
const [sideLeft] = repsOf(leftFixture as LandmarkRecording);
const sideGolden = { angle: sideRight, position: sideRight };

if (report) {
  const pair = (s: ReturnType<typeof score>) => `${String(s.anglePercent).padStart(4)}% ${s.angle.toFixed(1).padStart(4)}°  ${String(s.positionPercent).padStart(4)}% ${s.position.toFixed(3)}`;
  const row = (label: string, ...scores: ReturnType<typeof score>[]) => `${label.padEnd(28)} ${scores.map(pair).join("   |  ")}`;
  const lines = [
    `${"".padEnd(28)} one golden rep (app)            |  golden rep per arm`,
    `${"rep".padEnd(28)} angle        position           |  angle        position`,
    `golden reps: app angle #${front.indexOf(frontGolden.angle) + 1}, position #${front.indexOf(frontGolden.position) + 1}; ` +
      SIDES.map((side) => `${side} angle #${front.indexOf(ownGolden[side].angle) + 1}, position #${front.indexOf(ownGolden[side].position) + 1}`).join("; "),
    ...front.map((rep, i) => row(`front #${i + 1} ${rep.side} @${rep.endS.toFixed(1)}s`, frontScores[i], ownScores[i])),
    ...front.map((rep, i) => row(`front #${i + 1} ${rep.side} half`, halfScores[i], ownHalfScores[i])),
    row("side left (mirr.) vs right", score(sideGolden, sideLeft)),
    row("side right vs front golden", score(frontGolden, sideRight)),
    row("side left vs front golden", score(frontGolden, sideLeft)),
  ];
  console.log(lines.join("\n"));
}

describe("angle scorer and position scorer on recorded curls", () => {
  it("finds the front recording's reps on both sides", () => {
    for (const side of SIDES) expect(front.filter((rep) => rep.side === side).length).toBeGreaterThanOrEqual(8);
  });

  it("scores each golden rep as a perfect match", () => {
    expect(score(frontGolden, frontGolden.angle).anglePercent).toBe(100);
    expect(score(frontGolden, frontGolden.position).positionPercent).toBe(100);
  });

  it("with a golden rep per arm, the angle scorer puts every half rep further away than every full rep", () => {
    const full = front.flatMap((rep, i) => (rep === ownGolden[rep.side].angle ? [] : [ownScores[i].angle]));
    expect(Math.max(...ownHalfScores.map((s) => s.angle))).toBeGreaterThan(0);
    expect(Math.min(...ownHalfScores.map((s) => s.angle))).toBeGreaterThan(Math.max(...full));
  });

  it("with the app's one golden rep, the angle scorer separates half reps on the golden rep's own arm", () => {
    const side = frontGolden.angle.side;
    const full = front.flatMap((rep, i) => (rep.side === side && rep !== frontGolden.angle ? [frontScores[i].angle] : []));
    const half = front.flatMap((rep, i) => (rep.side === side ? [halfScores[i].angle] : []));
    expect(Math.min(...half)).toBeGreaterThan(Math.max(...full));
  });
});
