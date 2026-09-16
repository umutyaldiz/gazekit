import type { GazeVector, HeadPose } from "./types.js";

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/**
 * MediaPipe göz blendshape'lerinden yön vektörü üretir.
 * Blendshape adlarındaki "Left/Right" öznenin anatomik gözünü belirtir.
 * Özne SAĞA baktığında: sol göz içe (In) + sağ göz dışa (Out) döner.
 * Sonuç: +x = öznenin sağı = ekranın sağı, +y = yukarı. (Yaklaşık [-0.6, 0.6].)
 */
export function blendshapesToGaze(bs: Record<string, number>): GazeVector {
  const g = (n: string) => bs[n] ?? 0;
  const x =
    (g("eyeLookInLeft") + g("eyeLookOutRight") -
      (g("eyeLookOutLeft") + g("eyeLookInRight"))) /
    2;
  const y =
    (g("eyeLookUpLeft") + g("eyeLookUpRight") -
      (g("eyeLookDownLeft") + g("eyeLookDownRight"))) /
    2;
  return { x, y };
}

/**
 * MediaPipe facial transformation matrix'inden (column-major 4x4) yaklaşık
 * Euler açıları çıkarır. Radyan. Yaklaşıktır; yalnız kafa katkısı için kullanılır.
 */
export function matrixToEuler(m: Float32Array | number[]): HeadPose {
  const r00 = m[0], r10 = m[1];
  const r02 = m[8], r12 = m[9], r22 = m[10];
  const yaw = Math.atan2(r02, r22);
  const pitch = Math.atan2(-r12, Math.hypot(r02, r22));
  const roll = Math.atan2(r10, r00);
  return { yaw, pitch, roll };
}

/** Üstel hareketli ortalama tabanlı yumuşatıcı. */
export class EmaSmoother {
  private value: GazeVector | null = null;
  constructor(private alpha: number) {}

  push(next: GazeVector): GazeVector {
    if (!this.value) {
      this.value = { ...next };
    } else {
      this.value.x += this.alpha * (next.x - this.value.x);
      this.value.y += this.alpha * (next.y - this.value.y);
    }
    return { ...this.value };
  }

  reset(): void {
    this.value = null;
  }
}

const MAX_YAW = 0.6; // ~34° — kafa katkısı normalizasyonu
const MAX_PITCH = 0.5;

/** Göz vektörünü kazançla ölçekler ve (opsiyonel) kafa pozunu karıştırır. */
export function composeGaze(
  eye: GazeVector,
  head: HeadPose | undefined,
  gain: number,
  headInfluence: number
): GazeVector {
  let x = eye.x * gain;
  let y = eye.y * gain;
  if (head && headInfluence > 0) {
    x += headInfluence * clamp(head.yaw / MAX_YAW, -1, 1);
    y += headInfluence * clamp(head.pitch / MAX_PITCH, -1, 1);
  }
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}
