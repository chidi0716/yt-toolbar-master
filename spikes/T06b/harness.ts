// T06b 實測用：把擴充功能實際的深色模式模組（features/viewing/dark-mode.ts）打包成一段程式，
// 由 probe-home.mjs 以 Playwright 的 page.evaluate 放進 YouTube 首頁執行（工具列只在觀看頁出現，
// 而觀看頁在本環境會被驗證頁擋住）。這段程式只在實測腳本中使用，不屬於擴充功能。
// 擴充功能在 isolated world 執行同一段邏輯；兩者操作的是同一份 DOM 與 cookie。
import { createDarkMode } from '@/features/viewing/dark-mode';

const dark = createDarkMode();
dark.start();
(window as unknown as { __ytmDark: typeof dark }).__ytmDark = dark;
