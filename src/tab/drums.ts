// ドラムの各パートの定義と音作り
//
// 音源ファイルを使わず、Web Audio で音を合成している。
// キック = 低い音程が急降下するサイン波、スネア = ノイズ + 短い音程、
// シンバル類 = フィルタをかけたノイズ、という定番の作り方。

export interface DrumPart {
  id: string;
  label: string;
  /** TAB譜の行頭に出す短い名前 */
  short: string;
  color: string;
}

// 上から下へ、実際のドラム譜と同じ並び順
export const PARTS: DrumPart[] = [
  { id: "cc", label: "クラッシュ", short: "CC", color: "#ffd166" },
  { id: "rd", label: "ライド", short: "RD", color: "#f4a261" },
  { id: "ho", label: "ハイハット(開)", short: "HO", color: "#8ecae6" },
  { id: "hh", label: "ハイハット(閉)", short: "HH", color: "#219ebc" },
  { id: "sd", label: "スネア", short: "SD", color: "#ef476f" },
  { id: "t1", label: "ハイタム", short: "T1", color: "#b5838d" },
  { id: "t2", label: "ロータム", short: "T2", color: "#9d6b90" },
  { id: "ft", label: "フロアタム", short: "FT", color: "#7d5ba6" },
  { id: "bd", label: "キック", short: "BD", color: "#4dd97a" },
];

// ノイズ(ザーという音)の素材は1回作って使い回す
const noiseCache = new WeakMap<AudioContext, AudioBuffer>();

function getNoise(ctx: AudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** ノイズを指定フィルタ・長さで鳴らす(シンバル・スネア用の部品) */
function playNoise(
  ctx: AudioContext,
  dest: AudioNode,
  time: number,
  opts: { type: BiquadFilterType; freq: number; decay: number; gain: number },
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.value = opts.freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.gain, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + opts.decay);
  src.connect(filter).connect(gain).connect(dest);
  src.start(time);
  src.stop(time + opts.decay + 0.05);
}

/** 音程が下がっていく短い音(キック・タム用の部品) */
function playThump(
  ctx: AudioContext,
  dest: AudioNode,
  time: number,
  opts: { from: number; to: number; decay: number; gain: number },
): void {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(opts.from, time);
  osc.frequency.exponentialRampToValueAtTime(opts.to, time + opts.decay * 0.7);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.gain, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + opts.decay);
  osc.connect(gain).connect(dest);
  osc.start(time);
  osc.stop(time + opts.decay + 0.05);
}

/** パートIDに対応する音を time(AudioContextの時計) に鳴らす */
export function playDrum(
  ctx: AudioContext,
  dest: AudioNode,
  partId: string,
  time: number,
): void {
  switch (partId) {
    case "bd":
      playThump(ctx, dest, time, { from: 130, to: 45, decay: 0.25, gain: 1.1 });
      break;
    case "sd":
      playThump(ctx, dest, time, { from: 220, to: 170, decay: 0.1, gain: 0.4 });
      playNoise(ctx, dest, time, { type: "highpass", freq: 1200, decay: 0.18, gain: 0.7 });
      break;
    case "hh":
      playNoise(ctx, dest, time, { type: "highpass", freq: 7500, decay: 0.05, gain: 0.5 });
      break;
    case "ho":
      playNoise(ctx, dest, time, { type: "highpass", freq: 6500, decay: 0.35, gain: 0.45 });
      break;
    case "cc":
      playNoise(ctx, dest, time, { type: "highpass", freq: 4500, decay: 1.1, gain: 0.6 });
      break;
    case "rd":
      playNoise(ctx, dest, time, { type: "bandpass", freq: 9000, decay: 0.5, gain: 0.45 });
      playThump(ctx, dest, time, { from: 1250, to: 1250, decay: 0.25, gain: 0.06 });
      break;
    case "t1":
      playThump(ctx, dest, time, { from: 240, to: 130, decay: 0.3, gain: 0.8 });
      break;
    case "t2":
      playThump(ctx, dest, time, { from: 180, to: 95, decay: 0.35, gain: 0.8 });
      break;
    case "ft":
      playThump(ctx, dest, time, { from: 130, to: 65, decay: 0.4, gain: 0.9 });
      break;
  }
}
