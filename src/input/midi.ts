// MIDI 入力: 電子ドラム(Donner DED-300X など)を USB で繋いだときに使う
// パッドを叩くと「ノートオン」というメッセージが来るので、その時刻を拾う。
// マイクより正確で、周囲の音にも影響されないのが利点。

export type MidiHitCallback = (audioTime: number, note: number, velocity: number) => void;

export class MidiInput {
  private ctx: AudioContext;
  private access: MIDIAccess | null = null;
  private onHit: MidiHitCallback | null = null;
  /** 接続中のデバイス名一覧(UI 表示用) */
  deviceNames: string[] = [];
  onDevicesChanged: ((names: string[]) => void) | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  async start(onHit: MidiHitCallback): Promise<void> {
    this.onHit = onHit;
    this.access = await navigator.requestMIDIAccess();
    this.attachAll();
    this.access.onstatechange = () => this.attachAll();
  }

  private attachAll(): void {
    if (!this.access) return;
    this.deviceNames = [];
    this.access.inputs.forEach((input) => {
      this.deviceNames.push(input.name ?? "不明なデバイス");
      input.onmidimessage = (e) => this.handleMessage(e);
    });
    this.onDevicesChanged?.(this.deviceNames);
  }

  private handleMessage(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 3) return;
    const status = data[0] & 0xf0;
    const velocity = data[2];
    // ノートオン(0x90)かつ velocity > 0 が「叩いた」イベント
    if (status === 0x90 && velocity > 0) {
      // MIDI イベントの時刻は performance.now() 基準なので、
      // メトロノームと同じ AudioContext の時計に変換する
      const audioTime =
        this.ctx.currentTime + (e.timeStamp - performance.now()) / 1000;
      this.onHit?.(audioTime, data[1], velocity);
    }
  }

  stop(): void {
    this.access?.inputs.forEach((input) => {
      input.onmidimessage = null;
    });
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.onHit = null;
  }
}
