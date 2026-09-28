import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type ModelVariant = "lite" | "full" | "heavy";

const modelUrl = (variant: ModelVariant) =>
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/" +
  `pose_landmarker_${variant}/float16/latest/pose_landmarker_${variant}.task`;

export class PoseDetector {
  private lastTimestampMs = -1;

  private constructor(
    private readonly landmarker: PoseLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {}

  static async create(variant: ModelVariant = "full"): Promise<PoseDetector> {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe-wasm`);
    const create = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl(variant), delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    try {
      return new PoseDetector(await create("GPU"), "GPU");
    } catch {
      // Some phones and browsers can't run WebGL inference; the CPU path is slower but works.
      return new PoseDetector(await create("CPU"), "CPU");
    }
  }

  /** Landmarks for the most prominent pose in the frame, normalized to 0-1, or null if none. */
  detect(frame: HTMLVideoElement, timestampMs: number): NormalizedLandmark[] | null {
    // VIDEO mode rejects timestamps that don't strictly increase.
    const ts = Math.max(Math.round(timestampMs), this.lastTimestampMs + 1);
    this.lastTimestampMs = ts;
    return this.landmarker.detectForVideo(frame, ts).landmarks[0] ?? null;
  }

  close(): void {
    this.landmarker.close();
  }
}
