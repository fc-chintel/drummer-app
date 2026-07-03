// タイミング判定: 「叩いた時刻」と「拍の時刻」を比べてズレを出す

import type { Beat } from "../audio/metronome";

export type Grade = "perfect" | "good" | "ok" | "miss";

export interface Judgement {
  grade: Grade;
  /** ズレ(ミリ秒)。マイナス = 早い(走り気味)、プラス = 遅い(もたり気味) */
  offsetMs: number;
  beat: Beat;
}

// 判定の幅(ミリ秒)。初心者向けにやや甘め。
export const THRESHOLDS = {
  perfect: 35,
  good: 70,
  ok: 120,
} as const;

/**
 * 叩いた時刻に一番近い拍を探して判定する。
 * どの拍からも遠すぎる(ok の範囲外)なら null を返す = ノーカウント。
 * フィルインなど拍以外を叩くこともあるので、遠い音は無視するのが実用的。
 */
export function judgeHit(
  hitTime: number,
  beats: readonly Beat[],
  latencyCompensationMs: number,
): Judgement | null {
  if (beats.length === 0) return null;
  const t = hitTime - latencyCompensationMs / 1000;

  // 後ろから探す(直近の拍ほど配列の後ろにあるため)
  let nearest: Beat = beats[beats.length - 1];
  let nearestDiff = Math.abs(t - nearest.time);
  for (let i = beats.length - 2; i >= 0; i--) {
    const diff = Math.abs(t - beats[i].time);
    if (diff < nearestDiff) {
      nearest = beats[i];
      nearestDiff = diff;
    } else if (beats[i].time < t - 2) {
      break; // これより前の拍はもっと遠いだけなので打ち切り
    }
  }

  const offsetMs = (t - nearest.time) * 1000;
  const abs = Math.abs(offsetMs);
  let grade: Grade;
  if (abs <= THRESHOLDS.perfect) grade = "perfect";
  else if (abs <= THRESHOLDS.good) grade = "good";
  else if (abs <= THRESHOLDS.ok) grade = "ok";
  else return null;

  return { grade, offsetMs, beat: nearest };
}

export interface SessionStats {
  hitCount: number;
  perfectCount: number;
  goodCount: number;
  okCount: number;
  /** 平均ズレ(ms)。マイナスなら全体的に走り気味 */
  meanOffsetMs: number;
  /** ズレのばらつき(標準偏差, ms)。小さいほど安定している */
  stdDevMs: number;
  score: number;
  maxCombo: number;
}

/** セッション中の判定を集計してまとめを作る */
export function summarize(judgements: readonly Judgement[]): SessionStats {
  const n = judgements.length;
  const offsets = judgements.map((j) => j.offsetMs);
  const mean = n > 0 ? offsets.reduce((a, b) => a + b, 0) / n : 0;
  const variance =
    n > 0 ? offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0;

  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  for (const j of judgements) {
    if (j.grade === "perfect") {
      score += 100;
      combo += 1;
    } else if (j.grade === "good") {
      score += 50;
      combo += 1;
    } else {
      score += 10;
      combo = 0;
    }
    maxCombo = Math.max(maxCombo, combo);
  }

  return {
    hitCount: n,
    perfectCount: judgements.filter((j) => j.grade === "perfect").length,
    goodCount: judgements.filter((j) => j.grade === "good").length,
    okCount: judgements.filter((j) => j.grade === "ok").length,
    meanOffsetMs: mean,
    stdDevMs: Math.sqrt(variance),
    score,
    maxCombo,
  };
}

/** まとめから一言アドバイスを作る */
export function adviceText(stats: SessionStats): string {
  if (stats.hitCount < 8) return "もう少し長く叩いてみよう!";
  const parts: string[] = [];
  if (stats.meanOffsetMs < -15) {
    parts.push("全体的に走り気味(早め)。クリックを「聴いてから」叩く意識で!");
  } else if (stats.meanOffsetMs > 15) {
    parts.push("全体的にもたり気味(遅め)。少し前のめりの気持ちで!");
  } else {
    parts.push("平均はほぼジャスト!");
  }
  if (stats.stdDevMs > 40) {
    parts.push("ばらつきが大きめ。テンポを落として安定させよう。");
  } else if (stats.stdDevMs < 20) {
    parts.push("ばらつきも小さくて安定感バッチリ!");
  }
  return parts.join(" ");
}
