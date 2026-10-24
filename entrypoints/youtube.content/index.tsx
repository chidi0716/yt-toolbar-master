// 工具列與觀看輔助功能的內容腳本（isolated world，plan 3.1）。
import { startToolbar } from './mount';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    try {
      await startToolbar(ctx);
    } catch (err) {
      // 不得讓 YouTube 頁面出錯（constitution 第 7 點）。
      console.info('[yt-toolbar-master] toolbar failed to start', err);
    }
  },
});
