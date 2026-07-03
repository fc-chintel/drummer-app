import { useEffect, useRef, useState } from "react";
import { Metronome, type Beat, type MetronomeConfig } from "./audio/metronome";
import { MicInput } from "./input/mic";
import { MidiInput } from "./input/midi";
import {
  judgeHit,
  summarize,
  adviceText,
  type Judgement,
  type SessionStats,
} from "./game/judge";
import TabEditor from "./tab/TabEditor";

type InputMode = "mic" | "midi" | "tap";

// 入力方式ごとの遅れ補正の初期値(ms)。
// マイクは音が届く+処理の遅れがあるので少し多めに補正する。
const DEFAULT_LATENCY: Record<InputMode, number> = { mic: 40, midi: 0, tap: 0 };

const GRADE_LABEL: Record<string, string> = {
  perfect: "パーフェクト!",
  good: "グッド!",
  ok: "おしい",
};

interface HistoryEntry {
  date: string;
  bpm: number;
  gap: boolean;
  stats: SessionStats;
}

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem("drumcoach-history") ?? "[]");
  } catch {
    return [];
  }
}

type View = "trainer" | "tab";

export default function App() {
  // ---- 画面切り替え(リズム練習 / TAB譜エディタ) ----
  const [view, setView] = useState<View>("trainer");

  // ---- 設定 ----
  const [bpm, setBpm] = useState(90);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [gapEnabled, setGapEnabled] = useState(false);
  const [soundBars, setSoundBars] = useState(2);
  const [muteBars, setMuteBars] = useState(2);
  const [inputMode, setInputMode] = useState<InputMode>("mic");
  const [latencyMs, setLatencyMs] = useState(DEFAULT_LATENCY.mic);
  const [sensitivity, setSensitivity] = useState(4);

  // ---- 実行中の状態 ----
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [currentBeat, setCurrentBeat] = useState<Beat | null>(null);
  const [lastJudgement, setLastJudgement] = useState<Judgement | null>(null);
  const [combo, setCombo] = useState(0);
  const [hitCount, setHitCount] = useState(0);
  const [summary, setSummary] = useState<SessionStats | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  // オーディオ系のオブジェクトは再レンダリングで作り直したくないので ref に持つ
  const ctxRef = useRef<AudioContext | null>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  const micRef = useRef<MicInput | null>(null);
  const midiRef = useRef<MidiInput | null>(null);
  const judgementsRef = useRef<Judgement[]>([]);
  const lastHitTimeRef = useRef(-1);
  const comboRef = useRef(0);
  const latencyRef = useRef(latencyMs);
  latencyRef.current = latencyMs;

  // 入力方式を切り替えたら遅れ補正をその方式の初期値に戻す
  function changeInputMode(mode: InputMode) {
    setInputMode(mode);
    setLatencyMs(DEFAULT_LATENCY[mode]);
  }

  function handleHit(audioTime: number) {
    // キックとスネアを同時に踏む/叩くと 2 発来るので、50ms 以内はまとめて 1 発扱い
    if (audioTime - lastHitTimeRef.current < 0.05) return;
    lastHitTimeRef.current = audioTime;

    const metro = metronomeRef.current;
    if (!metro) return;
    const j = judgeHit(audioTime, metro.scheduledBeats, latencyRef.current);
    if (!j) return;

    judgementsRef.current.push(j);
    setHitCount(judgementsRef.current.length);
    setLastJudgement(j);
    if (j.grade === "perfect" || j.grade === "good") {
      comboRef.current += 1;
    } else {
      comboRef.current = 0;
    }
    setCombo(comboRef.current);
  }

  async function start() {
    setError(null);
    setSummary(null);
    judgementsRef.current = [];
    comboRef.current = 0;
    setHitCount(0);
    setCombo(0);
    setLastJudgement(null);

    try {
      const ctx = ctxRef.current ?? new AudioContext({ latencyHint: "interactive" });
      ctxRef.current = ctx;
      await ctx.resume(); // ブラウザの自動再生制限の解除(ボタン押下時なら OK)

      if (inputMode === "tap") {
        // タップモードは許可も機材もいらない。start() 後のトレーナー画面で
        // タップ/スペースキーを拾う(下の useEffect と onPointerDown)。
      } else if (inputMode === "midi") {
        if (!MidiInput.isSupported()) {
          throw new Error(
            "このブラウザは MIDI に対応していません。PC か Android の Chrome を使うか、マイク入力に切り替えてください。",
          );
        }
        const midi = new MidiInput(ctx);
        midiRef.current = midi;
        midi.onDevicesChanged = setMidiDevices;
        await midi.start((time) => handleHit(time));
      } else {
        const mic = new MicInput(ctx);
        micRef.current = mic;
        await mic.start((time) => handleHit(time));
        mic.setSensitivity(sensitivity);
      }

      const config: MetronomeConfig = {
        bpm,
        beatsPerBar,
        soundBars: gapEnabled ? soundBars : 0,
        muteBars: gapEnabled ? muteBars : 0,
      };
      const metro = new Metronome(ctx, config);
      metronomeRef.current = metro;
      // 拍は少し先の時刻で予約されるので、実際に鳴る瞬間に表示を更新する
      metro.onBeatScheduled = (beat) => {
        const delayMs = Math.max(0, (beat.time - ctx.currentTime) * 1000);
        window.setTimeout(() => setCurrentBeat(beat), delayMs);
      };
      metro.start();
      setRunning(true);
    } catch (e) {
      setError(toFriendlyError(e));
      stopInputs();
    }
  }

  /** ブラウザの英語エラーを分かりやすい日本語にする */
  function toFriendlyError(e: unknown): string {
    const name = e instanceof DOMException ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (name === "NotAllowedError" || /permission denied/i.test(msg)) {
      return "マイクの使用が許可されませんでした。アドレスバーの🔒マークからマイクを「許可」にしてもう一度スタートしてください。";
    }
    if (name === "NotFoundError") {
      return "マイクが見つかりませんでした。マイク付きの端末で開くか、入力方式を変えてください。";
    }
    return msg;
  }

  function stopInputs() {
    micRef.current?.stop();
    micRef.current = null;
    midiRef.current?.stop();
    midiRef.current = null;
    metronomeRef.current?.stop();
  }

  function stop() {
    stopInputs();
    setRunning(false);
    setCurrentBeat(null);

    const stats = summarize(judgementsRef.current);
    setSummary(stats);
    if (stats.hitCount > 0) {
      const entry: HistoryEntry = {
        date: new Date().toLocaleString("ja-JP"),
        bpm,
        gap: gapEnabled,
        stats,
      };
      const next = [entry, ...history].slice(0, 30);
      setHistory(next);
      localStorage.setItem("drumcoach-history", JSON.stringify(next));
    }
  }

  // マイク感度スライダーは実行中でも反映
  useEffect(() => {
    micRef.current?.setSensitivity(sensitivity);
  }, [sensitivity]);

  // タップモード: スペースキーでも叩ける(PC で試すとき用)
  useEffect(() => {
    if (!running || inputMode !== "tap") return;
    const onKey = (e: KeyboardEvent) => {
      // e.code が空になるブラウザ環境もあるので e.key too
      if ((e.code === "Space" || e.key === " ") && !e.repeat) {
        e.preventDefault();
        const ctx = ctxRef.current;
        if (ctx) handleHit(ctx.currentTime);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, inputMode]);

  // 画面を閉じるときに片付け
  useEffect(() => stopInputs, []);

  const offset = lastJudgement?.offsetMs ?? 0;
  // ズレメーター: ±120ms を横幅いっぱいにマッピング
  const meterPos = Math.max(-1, Math.min(1, offset / 120));

  // 画面を切り替えるとき、練習中なら止めてから移動する
  function switchView(v: View) {
    if (v !== "trainer" && running) stop();
    setView(v);
  }

  return (
    <div className="app">
      <h1>
        <span className="logo-text">BEAT LAB</span>
        <span className="subtitle">
          {view === "trainer" ? "リズムキープ・トレーナー" : "TAB譜エディタ"}
        </span>
      </h1>

      <nav className="view-nav">
        <button
          className={view === "trainer" ? "active" : ""}
          onClick={() => switchView("trainer")}
        >
          🎯 リズム練習
        </button>
        <button
          className={view === "tab" ? "active" : ""}
          onClick={() => switchView("tab")}
        >
          🎼 TAB譜エディタ
        </button>
      </nav>

      {view === "tab" && <TabEditor />}

      {view === "trainer" && error && <div className="error">{error}</div>}

      {view === "trainer" && !running && (
        <section className="card settings">
          <h2>設定</h2>
          <label>
            テンポ: <strong>{bpm} BPM</strong>
            <input
              type="range"
              min={40}
              max={200}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
            />
          </label>
          <label>
            拍子:
            <select
              value={beatsPerBar}
              onChange={(e) => setBeatsPerBar(Number(e.target.value))}
            >
              <option value={3}>3/4</option>
              <option value={4}>4/4</option>
              <option value={6}>6/8ふう (6拍)</option>
            </select>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={gapEnabled}
              onChange={(e) => setGapEnabled(e.target.checked)}
            />
            ギャップクリック(ときどきクリックが消えるモード)
          </label>
          {gapEnabled && (
            <div className="gap-settings">
              <label>
                鳴らす:
                <select value={soundBars} onChange={(e) => setSoundBars(Number(e.target.value))}>
                  {[1, 2, 4].map((n) => (
                    <option key={n} value={n}>{n}小節</option>
                  ))}
                </select>
              </label>
              <label>
                消す:
                <select value={muteBars} onChange={(e) => setMuteBars(Number(e.target.value))}>
                  {[1, 2, 4].map((n) => (
                    <option key={n} value={n}>{n}小節</option>
                  ))}
                </select>
              </label>
              <p className="hint">クリックが消えている間もテンポをキープして叩き続けよう!</p>
            </div>
          )}

          <label>
            入力方式:
            <select
              value={inputMode}
              onChange={(e) => changeInputMode(e.target.value as InputMode)}
            >
              <option value="mic">マイク(打音を拾う)</option>
              <option value="midi">MIDI(電子ドラムをUSB接続)</option>
              <option value="tap">タップ(画面タップ/スペースキー)</option>
            </select>
          </label>
          {inputMode === "midi" && !MidiInput.isSupported() && (
            <p className="hint warn">
              ⚠ このブラウザは MIDI 非対応です(iPhone/iPad の Safari など)。PC か Android の Chrome で開いてください。
            </p>
          )}

          <label>
            遅れ補正: <strong>{latencyMs} ms</strong>
            <input
              type="range"
              min={0}
              max={200}
              value={latencyMs}
              onChange={(e) => setLatencyMs(Number(e.target.value))}
            />
            <span className="hint">
              ジャストに叩いているのに「遅い」と出るときは増やしてみよう
            </span>
          </label>

          {inputMode === "mic" && (
            <label>
              マイク感度: <strong>{sensitivity}</strong>(小さいほど敏感)
              <input
                type="range"
                min={1}
                max={10}
                value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))}
              />
            </label>
          )}

          <button className="primary" onClick={start}>
            ▶ スタート
          </button>
        </section>
      )}

      {view === "trainer" && running && (
        <section className="card trainer">
          <div className="beat-lights">
            {Array.from({ length: beatsPerBar }, (_, i) => (
              <div
                key={i}
                className={
                  "light" +
                  (currentBeat?.beatInBar === i ? " on" : "") +
                  (currentBeat?.muted ? " muted" : "")
                }
              />
            ))}
          </div>
          {/* キープ表示は「出たり消えたり」で高さが変わるとタップ位置が
              ずれてしまうので、ギャップクリック中は常に場所を確保しておく */}
          {gapEnabled && (
            <div className={"gap-banner" + (currentBeat?.muted ? " show" : "")}>
              🤫 キープ!
            </div>
          )}

          {/* key を変えると毎回アニメーションが最初から再生される */}
          <div
            key={hitCount}
            className={"grade grade-" + (lastJudgement?.grade ?? "none")}
          >
            {lastJudgement ? GRADE_LABEL[lastJudgement.grade] : "叩いてみよう!"}
          </div>

          <div className="meter">
            <div className="meter-track">
              <div className="meter-center" />
              <div
                className="meter-needle"
                style={{ left: `${50 + meterPos * 50}%` }}
              />
            </div>
            <div className="meter-labels">
              <span>← 走り気味</span>
              <span>ジャスト</span>
              <span>もたり気味 →</span>
            </div>
            {/* こちらも初ヒットで急に現れるとレイアウトがずれるので常に場所を確保 */}
            <div className="offset-value">
              {lastJudgement
                ? `${offset > 0 ? "+" : ""}${offset.toFixed(0)} ms`
                : " "}
            </div>
          </div>

          {inputMode === "tap" && (
            <div
              className="tap-pad"
              onPointerDown={() => {
                const ctx = ctxRef.current;
                if (ctx) handleHit(ctx.currentTime);
              }}
            >
              ここをタップ!(PC ならスペースキーでも OK)
            </div>
          )}

          <div className="live-stats">
            <div>
              コンボ: <strong key={combo} className="combo-num">{combo}</strong>
            </div>
            <div>ヒット数: <strong>{hitCount}</strong></div>
            {inputMode === "midi" && (
              <div className="hint">
                {midiDevices.length > 0
                  ? `接続中: ${midiDevices.join(", ")}`
                  : "MIDI デバイスが見つかりません…USB ケーブルを確認"}
              </div>
            )}
          </div>

          <button className="danger" onClick={stop}>
            ■ ストップ
          </button>
        </section>
      )}

      {view === "trainer" && summary && !running && (
        <section className="card summary">
          <h2>今回の結果</h2>
          <div className="score">スコア: {summary.score}</div>
          <table>
            <tbody>
              <tr><td>ヒット数</td><td>{summary.hitCount}</td></tr>
              <tr><td>パーフェクト</td><td>{summary.perfectCount}</td></tr>
              <tr><td>グッド</td><td>{summary.goodCount}</td></tr>
              <tr><td>おしい</td><td>{summary.okCount}</td></tr>
              <tr><td>最大コンボ</td><td>{summary.maxCombo}</td></tr>
              <tr>
                <td>平均のズレ</td>
                <td>
                  {summary.meanOffsetMs > 0 ? "+" : ""}
                  {summary.meanOffsetMs.toFixed(1)} ms
                </td>
              </tr>
              <tr><td>ばらつき</td><td>{summary.stdDevMs.toFixed(1)} ms</td></tr>
            </tbody>
          </table>
          <p className="advice">{adviceText(summary)}</p>
        </section>
      )}

      {view === "trainer" && !running && history.length > 0 && (
        <section className="card history">
          <h2>これまでの記録</h2>
          <table>
            <thead>
              <tr>
                <th>日時</th><th>BPM</th><th>スコア</th><th>平均ズレ</th><th>ばらつき</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{h.date}{h.gap ? " 🤫" : ""}</td>
                  <td>{h.bpm}</td>
                  <td>{h.stats.score}</td>
                  <td>{h.stats.meanOffsetMs.toFixed(0)} ms</td>
                  <td>{h.stats.stdDevMs.toFixed(0)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
