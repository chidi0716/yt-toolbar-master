// T06b 實測共用：比對兩組「元素種類 → 顏色」的結果。
// - 完全相同：通過；
// - 近似：每個顏色的 RGB 各差不到 16、不透明度差不到 0.1（例如 #fff 對 #f1f1f1）。
//   這來自 YouTube 依載入時的主題以 `:root:root` 固定的少數變數，擴充功能改用 YouTube 樣式表中
//   [dark]／[light] 的值覆寫，與另一個主題載入時的固定值有些微差異；
// - 雜訊：滑鼠移入效果的顏色（YouTube 依影片縮圖決定，相同主題載入兩次也會不同），不列入比對。
const NOISE = [/^div\.ytSpecTouchFeedbackShapeHoverEffect$/];

const parse = (c) => {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;
};
const closeColor = (a, b) => {
  if (a === b) return true;
  const [x, y] = [parse(a), parse(b)];
  if (!x || !y) return false;
  return Math.abs(x[0] - y[0]) < 16 && Math.abs(x[1] - y[1]) < 16 && Math.abs(x[2] - y[2]) < 16 && Math.abs(x[3] - y[3]) <= 0.1;
};

export function compare(ref, got) {
  const keys = Object.keys(ref).filter((k) => k in got && !NOISE.some((re) => re.test(k)));
  const diff = keys.filter((k) => ref[k] !== got[k]);
  const approx = diff.filter((k) => {
    const [a, b] = [ref[k].split(' | '), got[k].split(' | ')];
    return a.length === b.length && a.every((v, i) => closeColor(v, b[i]));
  });
  const bad = diff.filter((k) => !approx.includes(k));
  return {
    compared: keys.length,
    mismatched: bad.length,
    examples: bad.slice(0, 8).map((k) => `${k}: ref=${ref[k]} got=${got[k]}`),
    approximate: approx.map((k) => `${k}: ref=${ref[k]} got=${got[k]}`),
  };
}
