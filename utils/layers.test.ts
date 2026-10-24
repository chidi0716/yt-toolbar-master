import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYER_LEVEL, pushLayer } from './layers';

const target = new EventTarget();
const esc = () => target.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));

describe('可以關閉的層（Esc 只關閉最上面的一層）', () => {
  beforeEach(() => {
    vi.stubGlobal('window', target);
  });

  it('面板與編輯模式在劇院模式之上，不論開啟的順序；關閉後換下一層', () => {
    const cinema = vi.fn();
    const panel = vi.fn();
    const closePanel = pushLayer({ level: LAYER_LEVEL.toolbar, onEscape: panel });
    const closeCinema = pushLayer({ level: LAYER_LEVEL.cinema, onEscape: cinema });
    esc();
    expect(panel).toHaveBeenCalledTimes(1);
    expect(cinema).not.toHaveBeenCalled();
    closePanel();
    esc();
    expect(cinema).toHaveBeenCalledTimes(1);
    closeCinema();
    closeCinema();
    esc();
    expect(cinema).toHaveBeenCalledTimes(1);
  });

  it('點外面只交給最上面的一層', () => {
    const close = vi.fn();
    let inside = true;
    const off = pushLayer({ level: LAYER_LEVEL.toolbar, onEscape: () => {}, outside: { inside: () => inside, close } });
    target.dispatchEvent(new Event('pointerdown'));
    expect(close).not.toHaveBeenCalled();
    inside = false;
    target.dispatchEvent(new Event('pointerdown'));
    expect(close).toHaveBeenCalledTimes(1);
    off();
  });
});
