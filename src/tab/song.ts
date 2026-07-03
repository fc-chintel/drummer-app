// TAB譜のデータ構造と保存(ブラウザの localStorage)

// 1小節 = 16分音符 × 16マス
export const STEPS_PER_BAR = 16;

export interface Song {
  title: string;
  bpm: number;
  bars: number;
  /** grid[パートID] = 各マスが 1(叩く) / 0(休み) の配列。長さ = bars * 16 */
  grid: Record<string, number[]>;
}

export function totalSteps(song: Song): number {
  return song.bars * STEPS_PER_BAR;
}

/** 空のマス目を作る(既存データがあれば長さを合わせてコピー) */
export function resizeGrid(song: Song, bars: number): Song {
  const steps = bars * STEPS_PER_BAR;
  const grid: Record<string, number[]> = {};
  for (const [part, cells] of Object.entries(song.grid)) {
    const next = new Array<number>(steps).fill(0);
    cells.slice(0, steps).forEach((v, i) => (next[i] = v));
    grid[part] = next;
  }
  return { ...song, bars, grid };
}

/** 最初に表示するお手本: ふつうの8ビート2小節 */
export function defaultSong(partIds: string[]): Song {
  const bars = 2;
  const steps = bars * STEPS_PER_BAR;
  const grid: Record<string, number[]> = {};
  for (const id of partIds) grid[id] = new Array(steps).fill(0);

  for (let bar = 0; bar < bars; bar++) {
    const o = bar * STEPS_PER_BAR;
    for (let i = 0; i < 16; i += 2) grid["hh"][o + i] = 1; // ハイハット8分
    grid["sd"][o + 4] = 1; // スネア2拍目
    grid["sd"][o + 12] = 1; // スネア4拍目
    grid["bd"][o + 0] = 1; // キック1拍目
    grid["bd"][o + 10] = 1; // キック「3拍目ウラ」
  }
  return { title: "8ビートのお手本", bpm: 100, bars, grid };
}

// ---- 保存・読み込み ----
const STORAGE_KEY = "drumcoach-songs";

export function loadLibrary(): Record<string, Song> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveSong(song: Song): void {
  const lib = loadLibrary();
  lib[song.title] = song;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
}

export function deleteSong(title: string): void {
  const lib = loadLibrary();
  delete lib[title];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
}
