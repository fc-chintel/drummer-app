// メトロノームエンジン
//
// setInterval だけで音を鳴らすとタイミングがガタガタになるので、
// 「少し先の拍を Web Audio のタイマーで予約しておく」方式(ルックアヘッド方式)を使う。
// これはブラウザで正確なメトロノームを作るときの定番テクニック。

export interface Beat {
  /** AudioContext の時計での鳴る時刻(秒) */
  time: number;
  /** 小節の中で何拍目か(0 始まり) */
  beatInBar: number;
  /** 曲の頭から数えて何小節目か(0 始まり) */
  bar: number;
  /** ギャップクリックで音を消している拍なら true(拍そのものは存在する) */
  muted: boolean;
}

export interface MetronomeConfig {
  bpm: number;
  beatsPerBar: number;
  /** ギャップクリック: 鳴らす小節数(0 なら常に鳴らす) */
  soundBars: number;
  /** ギャップクリック: 消す小節数 */
  muteBars: number;
}

export class Metronome {
  private ctx: AudioContext;
  private config: MetronomeConfig;
  private timerId: number | null = null;
  private nextBeatTime = 0;
  private beatCounter = 0;
  /** 判定に使うため、予約した拍をすべて覚えておく */
  readonly scheduledBeats: Beat[] = [];
  /** 拍を予約するたびに呼ばれる(UI の光る表示用) */
  onBeatScheduled: ((beat: Beat) => void) | null = null;

  // どのくらい先まで予約するか。長すぎると BPM 変更の反応が悪くなる。
  private static readonly LOOKAHEAD_SEC = 0.12;
  private static readonly TIMER_INTERVAL_MS = 25;

  constructor(ctx: AudioContext, config: MetronomeConfig) {
    this.ctx = ctx;
    this.config = config;
  }

  get isRunning(): boolean {
    return this.timerId !== null;
  }

  /** カウントイン(1小節ぶん鳴らしてからスタート扱いにする)付きで開始 */
  start(): void {
    if (this.timerId !== null) return;
    this.scheduledBeats.length = 0;
    this.beatCounter = 0;
    // ちょっと未来から始める(0.1 秒後)。過去の時刻は予約できないため。
    this.nextBeatTime = this.ctx.currentTime + 0.1;
    this.timerId = window.setInterval(
      () => this.schedulerTick(),
      Metronome.TIMER_INTERVAL_MS,
    );
    this.schedulerTick();
  }

  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private secondsPerBeat(): number {
    return 60 / this.config.bpm;
  }

  /** この小節は音を鳴らす小節か?(ギャップクリックの判定) */
  private isSoundBar(bar: number): boolean {
    const { soundBars, muteBars } = this.config;
    if (soundBars <= 0 || muteBars <= 0) return true;
    return bar % (soundBars + muteBars) < soundBars;
  }

  private schedulerTick(): void {
    // 「今から LOOKAHEAD 秒先」までに鳴るべき拍を全部予約する
    while (this.nextBeatTime < this.ctx.currentTime + Metronome.LOOKAHEAD_SEC) {
      const beatInBar = this.beatCounter % this.config.beatsPerBar;
      const bar = Math.floor(this.beatCounter / this.config.beatsPerBar);
      const muted = !this.isSoundBar(bar);

      const beat: Beat = { time: this.nextBeatTime, beatInBar, bar, muted };
      this.scheduledBeats.push(beat);
      if (!muted) {
        this.playClick(this.nextBeatTime, beatInBar === 0);
      }
      this.onBeatScheduled?.(beat);

      this.nextBeatTime += this.secondsPerBeat();
      this.beatCounter += 1;
    }
  }

  /** クリック音を鳴らす。1拍目(アクセント)は高い音にする */
  private playClick(time: number, accent: boolean): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1568 : 1047; // G6 / C6
    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}
