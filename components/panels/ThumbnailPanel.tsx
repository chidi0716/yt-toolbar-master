// 縮圖面板（002 FR-30 至 FR-32）：列出實際存在的縮圖尺寸，每個尺寸有預覽小圖，點了就下載。
// 不需要橋接程式。尺寸是否存在由背景腳本檢查（plan 3.8）。
import { useEffect, useState } from 'preact/hooks';
import { currentTitle, downloadErrorText, sendToBackground } from '@/features/downloads/content';
import { t } from '@/utils/i18n';
import type { ThumbnailInfo } from '@/utils/messages';
import { Icon } from '../icons';
import { PanelError, PanelLoading } from './PanelStatus';

type ListState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; thumbnails: ThumbnailInfo[] };
type RowStatus = { key: string; state: 'saving' | 'saved' | 'error'; message?: string };

const SAVED_MS = 2500;

export function ThumbnailPanel({ videoId }: { videoId: string }) {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [row, setRow] = useState<RowStatus | null>(null);

  useEffect(() => {
    let current = true;
    setList({ status: 'loading' });
    setRow(null);
    void sendToBackground<{ thumbnails: ThumbnailInfo[] }>({ type: 'getThumbnails', videoId }).then((res) => {
      if (current) setList(res.ok ? { status: 'ready', thumbnails: res.thumbnails } : { status: 'error' });
    });
    return () => {
      current = false;
    };
  }, [videoId, attempt]);

  useEffect(() => {
    if (row?.state !== 'saved') return;
    const timer = setTimeout(() => setRow(null), SAVED_MS);
    return () => clearTimeout(timer);
  }, [row]);

  if (list.status === 'loading') return <PanelLoading />;
  if (list.status === 'error') return <PanelError onRetry={() => setAttempt((n) => n + 1)} />;
  if (list.thumbnails.length === 0) return <p class="ytm-muted">{t('thumbnailNone')}</p>;

  const download = async (thumb: ThumbnailInfo) => {
    setRow({ key: thumb.key, state: 'saving' });
    const title = await currentTitle(videoId);
    const res = await sendToBackground({ type: 'downloadThumbnail', videoId, title, key: thumb.key });
    setRow(res.ok ? { key: thumb.key, state: 'saved' } : { key: thumb.key, state: 'error', message: downloadErrorText(res.error) });
  };

  return (
    <ul class="ytm-list ytm-thumbs">
      {list.thumbnails.map((thumb) => {
        const status = row?.key === thumb.key ? row : null;
        return (
          <li key={thumb.key}>
            <button
              type="button"
              class="ytm-list-row ytm-thumb-row"
              data-key={thumb.key}
              disabled={status?.state === 'saving'}
              onClick={() => void download(thumb)}
            >
              <img class="ytm-thumb-preview" src={thumb.url} alt="" width={96} height={Math.round((96 * thumb.height) / thumb.width)} />
              <span class="ytm-thumb-size">
                {thumb.width} × {thumb.height}
              </span>
              <span class="ytm-badge">JPG</span>
              <span class="ytm-row-status" aria-live="polite" data-state={status?.state}>
                {status?.state === 'saved' ? (
                  <>
                    <Icon name="check" size={20} />
                    <span>{t('downloadSaved')}</span>
                  </>
                ) : status?.state === 'error' ? (
                  <span role="alert">{status.message}</span>
                ) : (
                  <Icon name="download" size={20} />
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
