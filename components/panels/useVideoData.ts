import { useEffect, useState } from 'preact/hooks';
import { findVideo, type VideoData } from '@/utils/youtube/dom';
import { player } from '@/utils/youtube/player';

export type VideoDataState =
  | { status: 'loading' }
  | { status: 'error' }
  /** data 為 null：播放器還沒有這部影片的資料（只能用影片 ID）。 */
  | { status: 'ready'; data: VideoData | null };

/** 讀取目前影片的資料（標題、直播狀態）；換到另一部影片或重試時重新讀取。 */
export function useVideoData(videoId: string, attempt = 0): VideoDataState {
  const [state, setState] = useState<VideoDataState>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    player
      .getVideoData()
      .then((data) => current && setState({ status: 'ready', data: data?.videoId === videoId ? data : null }))
      .catch(() => current && setState({ status: 'error' }));
    return () => {
      current = false;
    };
  }, [videoId, attempt]);
  return state;
}

/** 直播中或尚未開始的影片（002 FR-1）。 */
export const isLiveOrUpcoming = (data: VideoData | null) => !!data && (data.isLive || data.isUpcoming);

/** 目前影片的長度（秒）；中繼資料載入或長度改變時更新。 */
export function useDuration(): number {
  const [duration, setDuration] = useState(() => findVideo()?.duration ?? Number.NaN);
  useEffect(() => {
    const video = findVideo();
    if (!video) return;
    const update = () => setDuration(video.duration);
    update();
    video.addEventListener('durationchange', update);
    video.addEventListener('loadedmetadata', update);
    return () => {
      video.removeEventListener('durationchange', update);
      video.removeEventListener('loadedmetadata', update);
    };
  }, []);
  return duration;
}
