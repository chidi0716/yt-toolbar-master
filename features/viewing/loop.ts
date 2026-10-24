// 循環播放（003 FR-50 至 FR-53，plan 3.7）：監聽 <video> 的 timeupdate 與 ended，
// 依 loop-logic 的判斷跳轉。不記住狀態；換到另一部影片時自動停止。
import { findVideo } from '@/utils/youtube/dom';
import { getVideoId } from '@/utils/youtube/page';
import { player } from '@/utils/youtube/player';
import { initialLoopState, isValidLoopConfig, loopTick, startLoop, type LoopConfig, type LoopState } from './loop-logic';
import { createStore, type Store, type ViewingFeature } from './store';

export interface LoopStatus {
  running: boolean;
  played: number;
  config: LoopConfig | null;
}

export interface LoopController extends ViewingFeature {
  status: Store<LoopStatus>;
  /** 以指定設定開始循環（設定不合法時不做任何事並回傳 false）。 */
  begin(config: LoopConfig): boolean;
  /** 停止循環。 */
  end(): void;
}

export function createLoop(): LoopController {
  const status = createStore<LoopStatus>({ running: false, played: 0, config: null });
  let loop: LoopState = initialLoopState();
  let config: LoopConfig | null = null;
  let video: HTMLVideoElement | null = null;
  let videoId: string | null = null;

  const seek = (seconds: number) => {
    // 透過 YouTube 播放器跳轉，讓播放器的狀態一致；失敗時直接設定 <video>。
    player.seekTo(seconds).catch(() => {
      if (video) video.currentTime = seconds;
    });
  };

  const detach = () => {
    video?.removeEventListener('timeupdate', onTime);
    video?.removeEventListener('ended', onEnded);
    video = null;
  };

  const step = (ended: boolean) => {
    if (!video || !config) return;
    const result = loopTick(loop, config, video.currentTime, video.duration, ended);
    loop = result.state;
    if (result.seekTo !== undefined) {
      seek(result.seekTo);
      if (ended || video.paused) void video.play().catch(() => {});
    }
    if (!loop.running) detach();
    // timeupdate 每秒觸發數次：狀態真的改變時才通知（面板與按鈕才重新繪製）。
    const prev = status.get();
    if (prev.running !== loop.running || prev.played !== loop.played || prev.config !== config) status.set({ running: loop.running, played: loop.played, config });
  };

  function onTime() {
    step(false);
  }
  function onEnded() {
    step(true);
  }

  const end = () => {
    detach();
    loop = initialLoopState();
    status.set((prev) => ({ ...prev, running: false }));
  };

  return {
    status,
    begin(next) {
      const target = findVideo();
      if (!target || !isValidLoopConfig(next, target.duration)) return false;
      detach();
      video = target;
      videoId = getVideoId(location.href);
      config = next;
      loop = startLoop();
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('ended', onEnded);
      status.set({ running: true, played: 0, config });
      // 先播放再跳轉：對已播完的影片呼叫 play() 會回到開頭，跳轉要在它之後。
      const outside = next.mode === 'segment' && (video.currentTime < next.start || video.currentTime >= next.end);
      if (video.paused) void video.play().catch(() => {});
      // 片段模式：目前位置不在片段內時，馬上跳到開始時間。
      if (outside && next.mode === 'segment') seek(next.start);
      return true;
    },
    end,
    start() {},
    stop: end,
    navigate() {
      // 換到另一部影片時循環自動停止（FR-53）。
      if (status.get().running && getVideoId(location.href) !== videoId) end();
    },
  };
}
