// 連結面板（004 第 4 節）：三種格式各一行，點了就複製並顯示「已複製」約 2 秒；
// 每行顯示實際會複製的文字（過長時中間省略），時間隨播放進度更新。
// 複製失敗時顯示錯誤與可以手動選取的文字框（FR-34）。
import { useEffect, useRef, useState } from 'preact/hooks';
import { LINK_KINDS, linkText, middleEllipsis, wholeSeconds, type LinkKind } from '@/features/link/link-logic';
import { t, type MessageKey } from '@/utils/i18n';
import { findVideo } from '@/utils/youtube/dom';
import { Icon } from '../icons';
import { useCopy } from '../useCopy';
import { PanelError, PanelLoading } from './PanelStatus';
import { useVideoData } from './useVideoData';

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

export function LinkPanel({ videoId }: { videoId: string }) {
  const seconds = useCurrentSeconds(videoId);
  const [attempt, setAttempt] = useState(0);
  const video = useVideoData(videoId, attempt);
  const { copied, failed, copy, reset } = useCopy<LinkKind>();
  const manualRef = useRef<HTMLTextAreaElement>(null);

  // 換頁時清除「已複製」與複製失敗的文字框。
  useEffect(reset, [videoId, reset]);

  // 複製失敗：選取文字框中的文字，方便手動複製。
  useEffect(() => {
    if (failed) {
      manualRef.current?.focus();
      manualRef.current?.select();
    }
  }, [failed]);

  if (video.status === 'loading') return <PanelLoading />;
  if (video.status === 'error') return <PanelError onRetry={() => setAttempt((n) => n + 1)} />;
  // 影片標題（Markdown 格式用）。
  const title = video.data?.title ?? '';

  return (
    <div class="ytm-copylink">
      <ul class="ytm-copylink-list">
        {LINK_KINDS.map((kind) => {
          const text = linkText(kind, videoId, title || videoId, seconds);
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
            aria-label={t(LABELS[failed.key])}
            value={failed.text}
          />
        </div>
      )}
    </div>
  );
}
