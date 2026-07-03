// マイク入力: 打音が聞こえた瞬間を検出する
// 実際の検出処理は public/onset-processor.js (AudioWorklet) がやる。
// ここではマイクの起動と、検出結果の受け取りだけを担当する。

export type HitCallback = (audioTime: number, level: number) => void;

export class MicInput {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  async start(onHit: HitCallback): Promise<void> {
    // エコーキャンセル等は打音検出の邪魔になるので全部オフにする
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    await this.ctx.audioWorklet.addModule("/onset-processor.js");
    this.workletNode = new AudioWorkletNode(this.ctx, "onset-processor");
    this.workletNode.port.onmessage = (e) => {
      if (e.data?.type === "hit") {
        onHit(e.data.time, e.data.level);
      }
    };

    const source = this.ctx.createMediaStreamSource(this.stream);
    source.connect(this.workletNode);
    // destination には繋がない(マイク音をスピーカーから出さない)
  }

  /** 感度調整: 大きいほど鈍感(誤検出が減る)、小さいほど敏感 */
  setSensitivity(value: number): void {
    this.workletNode?.port.postMessage({ type: "sensitivity", value });
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.workletNode?.disconnect();
    this.workletNode = null;
  }
}
