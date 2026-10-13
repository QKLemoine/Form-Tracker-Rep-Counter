import { FilesetResolver, PoseLandmarker, type Landmark, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type ModelVariant = "lite" | "full" | "heavy";

const modelUrl = (variant: ModelVariant) =>
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/" +
  `pose_landmarker_${variant}/float16/latest/pose_landmarker_${variant}.task`;

export interface Pose {
  /** Position in the image, normalized to 0-1 per axis, with a visibility score. */
  image: NormalizedLandmark[];
  /** Estimated 3D position in metres, relative to the hips. */
  world: Landmark[];
}

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

  /** The most prominent pose in the frame, or null if no one is in view. */
  detect(frame: HTMLVideoElement, timestampMs: number): Pose | null {
    // VIDEO mode rejects timestamps that don't strictly increase.
    const ts = Math.max(Math.round(timestampMs), this.lastTimestampMs + 1);
    this.lastTimestampMs = ts;
    const result = this.landmarker.detectForVideo(frame, ts);
    const image = result.landmarks[0];
    const world = result.worldLandmarks[0];
    return image && world ? { image, world } : null;
  }

  close(): void {
    this.landmarker.close();
  }
}
