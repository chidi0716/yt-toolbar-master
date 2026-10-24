// 複製到剪貼簿，成功時約 2 秒顯示「已複製」（004 FR-34、008 FR-1）。在點擊的使用者操作中直接呼叫（plan 3.7.1）。
// 失敗時記下要複製的文字，由呼叫端顯示可以手動選取的文字。
import { useCallback, useEffect, useState } from 'preact/hooks';

const COPIED_MS = 2000;

export interface CopyState<K> {
  /** 剛複製成功的項目；約 2 秒後回到 null（一次性的計時器）。 */
  copied: K | null;
  /** 複製失敗的項目與文字。 */
  failed: { key: K; text: string } | null;
  copy(key: K, text: string): void;
  reset(): void;
}

export function useCopy<K>(): CopyState<K> {
  const [copied, setCopied] = useState<K | null>(null);
  const [failed, setFailed] = useState<{ key: K; text: string } | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = useCallback((key: K, text: string) => {
    const write = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('clipboard unavailable'));
    write.then(
      () => {
        setFailed(null);
        setCopied(() => key);
      },
      (err: unknown) => {
        console.info('[yt-toolbar-master] copy failed', err);
        setCopied(null);
        setFailed({ key, text });
      },
    );
  }, []);
  const reset = useCallback(() => {
    setCopied(null);
    setFailed(null);
  }, []);
  return { copied, failed, copy, reset };
}
