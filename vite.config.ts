import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

// PWA設定: 公開したサイトを「ホーム画面に追加」で
// ネイティブアプリのように起動できるようにする。
// service worker がファイルをキャッシュするのでオフラインでも動く。
const pwa = VitePWA({
  registerType: "autoUpdate", // 新しいバージョンを公開したら自動で更新
  manifest: {
    name: "ドラムコーチ",
    short_name: "ドラムコーチ",
    description: "リズムキープ・トレーナー — 叩いたタイミングのズレを採点",
    lang: "ja",
    display: "standalone", // アドレスバーなしのアプリ風表示
    orientation: "portrait",
    background_color: "#0f1220",
    theme_color: "#0f1220",
    icons: [
      { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
});

// スマホから Wi-Fi 経由で使うときはマイクや MIDI のために https が必要。
// `npm run dev:phone` で起動すると自己署名証明書付きの https になる
// (スマホ側で警告が出たら「詳細設定 → アクセスする」で進んで OK)。
// 普段の PC 開発は `npm run dev`(http)で十分。
export default defineConfig(({ mode }) => ({
  plugins:
    mode === "phone" ? [react(), basicSsl(), pwa] : [react(), pwa],
  server: {
    host: true, // 同じ Wi-Fi のスマホからも見えるようにする
    port: 5173,
  },
}));
