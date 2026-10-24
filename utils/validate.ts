// 共用的輸入驗證（不信任外部程式、頁面與 storage 的值）。

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 橋接程式的工作 ID。 */
export const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const isValidJobId = (v: unknown): v is string => typeof v === 'string' && JOB_ID_PATTERN.test(v);
