import { useEffect, useRef, useState } from "react";
import { PARTS } from "./drums";
import { TabPlayer } from "./player";
import {
  STEPS_PER_BAR,
  defaultSong,
  deleteSong,
  loadLibrary,
  resizeGrid,
  saveSong,
  totalSteps,
  type Song,
} from "./song";

const PART_IDS = PARTS.map((p) => p.id);

export default function TabEditor() {
  const [song, setSong] = useState<Song>(() => {
    // 前回保存した曲があれば最初のものを開く。なければお手本の8ビート
    const lib = loadLibrary();
    const first = Object.values(lib)[0];
    return first ?? defaultSong(PART_IDS);
  });
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [soloed, setSoloed] = useState<Set<string>>(new Set());
  const [masterMute, setMasterMute] = useState(false);
  const [clickOn, setClickOn] = useState(false);
  const [library, setLibrary] = useState<Record<string, Song>>(loadLibrary);

  const ctxRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<TabPlayer | null>(null);

  // プレイヤーを用意する(初回だけ)。AudioContext はユーザー操作時に作る
  function getPlayer(): TabPlayer {
    if (!playerRef.current) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      ctxRef.current = ctx;
      const player = new TabPlayer(ctx, song);
      player.onStep = setCurrentStep;
      playerRef.current = player;
    }
    return playerRef.current;
  }

  // 曲・ミュート状態が変わったらプレイヤーに反映(再生中もリアルタイムに効く)
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    p.song = song;
    p.muted = muted;
    p.soloed = soloed;
    p.masterMute = masterMute;
    p.clickOn = clickOn;
  }, [song, muted, soloed, masterMute, clickOn]);

  // 画面を離れるとき再生を止める
  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      ctxRef.current?.close();
    };
  }, []);

  async function togglePlay() {
    const p = getPlayer();
    await ctxRef.current!.resume();
    if (p.isPlaying) {
      p.stop();
      setPlaying(false);
    } else {
      p.play();
      setPlaying(true);
    }
  }

  function toggleCell(partId: string, step: number) {
    setSong((s) => {
      const cells = [...s.grid[partId]];
      cells[step] = cells[step] === 1 ? 0 : 1;
      // 新しく置いたときだけ試し打ちで音を確認できる
      if (cells[step] === 1) {
        const p = getPlayer();
        ctxRef.current!.resume().then(() => p.preview(partId));
      }
      return { ...s, grid: { ...s.grid, [partId]: cells } };
    });
  }

  function toggleSet(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function changeBars(delta: number) {
    setSong((s) => {
      const bars = Math.max(1, Math.min(16, s.bars + delta));
      return bars === s.bars ? s : resizeGrid(s, bars);
    });
  }

  function handleSave() {
    const title = window.prompt("曲の名前", song.title);
    if (!title) return;
    const named = { ...song, title };
    setSong(named);
    saveSong(named);
    setLibrary(loadLibrary());
  }

  function handleLoad(title: string) {
    if (!title) return;
    const s = library[title];
    if (s) setSong(s);
  }

  function handleDelete() {
    if (!library[song.title]) return;
    if (!window.confirm(`「${song.title}」を削除する?`)) return;
    deleteSong(song.title);
    setLibrary(loadLibrary());
  }

  function handleNew() {
    setSong(defaultSong(PART_IDS));
  }

  const steps = totalSteps(song);

  return (
    <div className="tab-editor">
      <section className="card">
        <div className="tab-toolbar">
          <button className={"play-btn" + (playing ? " playing" : "")} onClick={togglePlay}>
            {playing ? "■ 停止" : "▶ 再生"}
          </button>
          <label>
            BPM
            <input
              type="number"
              min={40}
              max={220}
              value={song.bpm}
              onChange={(e) =>
                setSong((s) => ({ ...s, bpm: Number(e.target.value) || s.bpm }))
              }
            />
          </label>
          <label className="bars-control">
            小節
            <button onClick={() => changeBars(-1)}>−</button>
            <strong>{song.bars}</strong>
            <button onClick={() => changeBars(1)}>＋</button>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={clickOn}
              onChange={(e) => setClickOn(e.target.checked)}
            />
            クリック
          </label>
          <button
            className={"mute-all" + (masterMute ? " on" : "")}
            onClick={() => setMasterMute(!masterMute)}
          >
            {masterMute ? "🔇 全ミュート中" : "🔊 全部鳴らす"}
          </button>
        </div>

        <div className="grid-scroll">
          <table className="tab-grid">
            <tbody>
              {PARTS.map((part) => {
                const isMuted = muted.has(part.id);
                const isSolo = soloed.has(part.id);
                // ソロが1つでもあると、ソロ以外は実質ミュート
                const silenced =
                  masterMute ||
                  isMuted ||
                  (soloed.size > 0 && !isSolo);
                return (
                  <tr key={part.id} className={silenced ? "silenced" : ""}>
                    <th>
                      <span className="part-name" title={part.label}>
                        {part.short}
                      </span>
                      <button
                        className={"ms-btn" + (isMuted ? " active-m" : "")}
                        title={`${part.label}をミュート`}
                        onClick={() => setMuted(toggleSet(muted, part.id))}
                      >
                        M
                      </button>
                      <button
                        className={"ms-btn" + (isSolo ? " active-s" : "")}
                        title={`${part.label}をソロ`}
                        onClick={() => setSoloed(toggleSet(soloed, part.id))}
                      >
                        S
                      </button>
                    </th>
                    {Array.from({ length: steps }, (_, i) => (
                      <td
                        key={i}
                        className={
                          "cell" +
                          (i % STEPS_PER_BAR === 0 ? " bar-start" : "") +
                          (i % 4 === 0 ? " beat-start" : "") +
                          (i === currentStep ? " playhead" : "")
                        }
                        onPointerDown={() => toggleCell(part.id, i)}
                      >
                        {song.grid[part.id][i] === 1 && (
                          <span
                            className="dot"
                            style={{ background: part.color }}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint">
          マスをタップして打ち込み(もう一度タップで消す)。M=ミュート、S=ソロ。行の左の名前は
          CC=クラッシュ / RD=ライド / HO=ハイハット開 / HH=ハイハット閉 / SD=スネア /
          T1・T2=タム / FT=フロアタム / BD=キック
        </p>
      </section>

      <section className="card song-manager">
        <h2>曲の保存</h2>
        <div className="song-row">
          <span className="song-title">
            いま開いている曲: <strong>{song.title}</strong>
          </span>
          <button onClick={handleSave}>💾 保存</button>
          <button onClick={handleNew}>🆕 新規</button>
          {library[song.title] && (
            <button className="danger-text" onClick={handleDelete}>
              🗑 削除
            </button>
          )}
        </div>
        {Object.keys(library).length > 0 && (
          <div className="song-row">
            <label>
              保存した曲を開く:
              <select value="" onChange={(e) => handleLoad(e.target.value)}>
                <option value="">選んでください</option>
                {Object.keys(library).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>
    </div>
  );
}
