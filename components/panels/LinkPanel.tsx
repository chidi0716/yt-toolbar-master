// 連結面板（004 第 4 節）：三種格式各一行，點了就複製並顯示「已複製」約 2 秒；
// 每行顯示實際會複製的文字（過長時中間省略），時間隨播放進度更新。
// 複製失敗時顯示錯誤與可以手動選取的文字框（FR-34）。
import { useEffect, useRef, useState } from 'preact/hooks';
import { LINK_KINDS, linkText, middleEllipsis, wholeSeconds, type LinkKind } from '@/features/link/link-logic';
import { t, type MessageKey } from '@/utils/i18n';
import { findVideo } from '@/utils/youtube/dom';
import { player } from '@/utils/youtube/player';
import { Icon } from '../icons';
import { PanelError, PanelLoading } from './PanelStatus';

const LOG_PREFIX = '[yt-toolbar-master]';
const COPIED_MS = 2000;
const PREVIEW_MAX = 52;

const LABELS: Record<LinkKind, MessageKey> = {
  time: 'linkAtTime',
  markdown: 'linkMarkdown',
  plain: 'linkPlain',
};

/** 播放器目前時間（整數秒），隨 timeupdate／seeked 更新；只在面板開著時監聽。 */
function useCurrentSeconds(videoId: string): number {
  const read = () => wholeSeconds(findVideo()?.currentTime ?? 0);
  const [seconds, setSeconds] = useState(read);
  useEffect(() => {
    const video = findVideo();
    setSeconds(read());
    if (!video) return;
    const update = () => setSeconds(wholeSeconds(video.currentTime));
    video.addEventListener('timeupdate', update);
    video.addEventListener('seeked', update);
    return () => {
      video.removeEventListener('timeupdate', update);
      video.removeEventListener('seeked', update);
    };
  }, [videoId]);
  return seconds;
}

type TitleState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; title: string };

export function LinkPanel({ videoId }: { videoId: string }) {
  const seconds = useCurrentSeconds(videoId);
  const [title, setTitle] = useState<TitleState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState<LinkKind | null>(null);
  const [failed, setFailed] = useState<{ kind: LinkKind; text: string } | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  // 影片標題（Markdown 格式用）：換頁時重新讀取。
  useEffect(() => {
    let current = true;
    setTitle({ status: 'loading' });
    setCopied(null);
    setFailed(null);
    player
      .getVideoData()
      .then((data) => {
        if (current) setTitle({ status: 'ready', title: data?.videoId === videoId ? data.title : '' });
      })
      .catch((err: unknown) => {
        console.info(`${LOG_PREFIX} link panel: failed to read the video title`, err);
        if (current) setTitle({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [videoId, attempt]);

  // 「已複製」：一次性的計時器（001 NFR-3）。
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // 複製失敗：選取文字框中的文字，方便手動複製。
  useEffect(() => {
    if (failed) {
      manualRef.current?.focus();
      manualRef.current?.select();
    }
  }, [failed]);

  if (title.status === 'loading') return <PanelLoading />;
  if (title.status === 'error') return <PanelError onRetry={() => setAttempt((n) => n + 1)} />;

  const copy = (kind: LinkKind, text: string) => {
    // 在點擊的使用者操作中直接呼叫（plan 3.7.1）。
    const write = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('clipboard unavailable'));
    write.then(
      () => {
        setFailed(null);
        setCopied(kind);
      },
      (err: unknown) => {
        console.info(`${LOG_PREFIX} link panel: copy failed`, err);
        setCopied(null);
        setFailed({ kind, text });
      },
    );
  };

  return (
    <div class="ytm-copylink">
      <ul class="ytm-copylink-list">
        {LINK_KINDS.map((kind) => {
          const text = linkText(kind, videoId, title.title || videoId, seconds);
          const isCopied = copied === kind;
          return (
            <li key={kind}>
              <button type="button" class="ytm-copylink-row" data-kind={kind} data-copied={isCopied ? '' : undefined} onClick={() => copy(kind, text)}>
                <span class="ytm-copylink-text">
                  <span class="ytm-copylink-name">{t(LABELS[kind])}</span>
                  <span class="ytm-copylink-preview" title={text}>
                    {middleEllipsis(text, PREVIEW_MAX)}
                  </span>
                </span>
                <span class="ytm-copylink-status" aria-live="polite">
                  {isCopied ? (
                    <>
                      <Icon name="check" size={20} />
                      <span>{t('linkCopied')}</span>
                    </>
                  ) : (
                    <Icon name="content_copy" size={20} />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {failed && (
        <div class="ytm-copylink-manual">
          <p class="ytm-field-error" role="alert">
            {t('linkCopyFailed')}
          </p>
          <textarea
            ref={manualRef}
            class="ytm-input ytm-copylink-manual-text"
            readOnly
            rows={2}
            aria-label={t(LABELS[failed.kind])}
            value={failed.text}
          />
        </div>
      )}
    </div>
  );
}
