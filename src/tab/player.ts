// TAB譜の再生エンジン
// メトロノーム(audio/metronome.ts)と同じルックアヘッド方式で、
// 16分音符のマス目を順番に予約再生していく。

import { playDrum } from "./drums";
import { STEPS_PER_BAR, totalSteps, type Song } from "./song";

export class TabPlayer {
  private ctx: AudioContext;
  private master: GainNode;
  private timerId: number | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;

  /** 再生する曲。再生中に差し替えてもOK(編集しながら聴ける) */
  song: Song;
  /** ミュート中のパートID */
  muted = new Set<string>();
  /** ソロ中のパートID(1つでもあればソロのパートだけ鳴る) */
  soloed = new Set<string>();
  /** 全パートミュート(クリックだけ鳴らして自分で叩く練習用) */
  masterMute = false;
  /** メトロノームのクリックを一緒に鳴らすか */
  clickOn = false;
  /** 再生位置が進むたびに呼ばれる(画面のハイライト用) */
  onStep: ((step: number) => void) | null = null;

  private static readonly LOOKAHEAD_SEC = 0.12;
  private static readonly TIMER_INTERVAL_MS = 25;

  constructor(ctx: AudioContext, song: Song) {
    this.ctx = ctx;
    this.song = song;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
  }

  get isPlaying(): boolean {
    return this.timerId !== null;
  }

  /** このパートは今鳴らすべきか?(ミュート/ソロの判定) */
  private audible(partId: string): boolean {
    if (this.masterMute) return false;
    if (this.muted.has(partId)) return false;
    if (this.soloed.size > 0 && !this.soloed.has(partId)) return false;
    return true;
  }

  play(): void {
    if (this.timerId !== null) return;
    this.stepIndex = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.timerId = window.setInterval(
      () => this.tick(),
      TabPlayer.TIMER_INTERVAL_MS,
    );
    this.tick();
  }

  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.onStep?.(-1);
  }

  private secondsPerStep(): number {
    return 60 / this.song.bpm / 4; // 16分音符1個ぶん
  }

  private tick(): void {
    while (this.nextStepTime < this.ctx.currentTime + TabPlayer.LOOKAHEAD_SEC) {
      const step = this.stepIndex % totalSteps(this.song);
      const time = this.nextStepTime;

      // 各パートのマスが1なら鳴らす
      for (const [partId, cells] of Object.entries(this.song.grid)) {
        if (cells[step] === 1 && this.audible(partId)) {
          playDrum(this.ctx, this.master, partId, time);
        }
      }

      // クリック(4分音符ごと、小節頭はアクセント)
      if (this.clickOn && step % 4 === 0) {
        const accent = step % STEPS_PER_BAR === 0;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = accent ? 1568 : 1047;
        gain.gain.setValueAtTime(0.4, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        osc.connect(gain).connect(this.master);
        osc.start(time);
        osc.stop(time + 0.05);
      }

      // 画面のハイライトは実際に鳴る瞬間に合わせて更新
      const delayMs = Math.max(0, (time - this.ctx.currentTime) * 1000);
      window.setTimeout(() => {
        if (this.isPlaying) this.onStep?.(step);
      }, delayMs);

      this.nextStepTime += this.secondsPerStep();
      this.stepIndex += 1;
    }
  }

  /** 打ち込み時の試し打ち(すぐ鳴らす) */
  preview(partId: string): void {
    playDrum(this.ctx, this.master, partId, this.ctx.currentTime);
  }
}
