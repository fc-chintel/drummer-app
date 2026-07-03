// マイク打音検出プロセッサ (AudioWorklet)
//
// マイクの音を 128 サンプルずつ受け取り、音量(RMS)が急に跳ね上がった瞬間を
// 「叩いた!」として検出する。AudioWorklet は音声スレッドで動くので、
// 画面が忙しくてもタイミング検出がずれないのが利点。
//
// 検出したら { type: "hit", time: 秒, level: 音量 } をメインスレッドに送る。
// time は AudioContext の時計(メトロノームと同じ時計)なのでそのまま比較できる。

class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noiseFloor = 0.0005; // 周囲の静かさの推定値(ゆっくり追従する)
    this.prevRms = 0;
    this.lastHitTime = -1;
    this.refractorySec = 0.06; // 一発検出したら 60ms は次を検出しない(連打誤検出防止)
    this.sensitivity = 4; // 大きいほど鈍感。UI から変更できる
    this.port.onmessage = (e) => {
      if (e.data?.type === "sensitivity") {
        this.sensitivity = e.data.value;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];

    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    const now = currentFrame / sampleRate;

    // ノイズフロア(環境音の大きさ)をゆっくり学習する
    this.noiseFloor = Math.max(0.0003, this.noiseFloor * 0.999 + rms * 0.001);

    const threshold = this.noiseFloor * this.sensitivity * 10;
    const rising = rms > this.prevRms * 2.5; // 音量が急上昇している
    const loudEnough = rms > Math.max(threshold, 0.01);
    const notTooSoon = now - this.lastHitTime > this.refractorySec;

    if (rising && loudEnough && notTooSoon) {
      this.lastHitTime = now;
      this.port.postMessage({ type: "hit", time: now, level: rms });
    }

    this.prevRms = rms;
    return true;
  }
}

registerProcessor("onset-processor", OnsetProcessor);
