import { describe, expect, it, vi } from 'vitest';
import {
  keepVisibleOnWidthReflow,
  type WidthReflowPlatform,
} from './width-reflow-anchor';

function setup() {
  const root = document.createElement('div'),
    receipt = document.createElement('section');
  root.append(receipt);
  document.body.append(root);
  let width = 390,
    top = 350,
    active = true;
  let scope: readonly unknown[] = ['query', 'project', {}];
  let observe: (visible: boolean) => void = () => undefined;
  let resize: () => void = () => undefined;
  let serial = 0;
  const frames = new Map<number, () => void>();
  const unobserve = vi.fn(),
    unresize = vi.fn();
  root.getBoundingClientRect = () =>
    ({ top: 44, bottom: 664, left: 0, right: width }) as DOMRect;
  receipt.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + 56,
      left: 16,
      right: width - 16,
      width: width - 32,
      height: 56,
    }) as DOMRect;
  const scroll = vi.fn(() => {
    top = 44;
  });
  receipt.scrollIntoView = scroll;
  const platform: WidthReflowPlatform = {
    width: () => width,
    frame: (callback) => {
      frames.set(++serial, callback);
      return serial;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    observe: (callback) => {
      observe = callback;
      return unobserve;
    },
    resize: (callback) => {
      resize = callback;
      return unresize;
    },
  };
  const anchor = keepVisibleOnWidthReflow(
    receipt,
    root,
    () => scope,
    () => active,
    platform,
  );
  return {
    anchor,
    receipt,
    root,
    scroll,
    unobserve,
    unresize,
    frames,
    observe: (visible: boolean) => observe(visible),
    resize: (nextWidth = width) => {
      width = nextWidth;
      resize();
    },
    setWidth: (value: number) => {
      width = value;
    },
    setTop: (value: number) => {
      top = value;
    },
    setScope: () => {
      scope = ['query', 'project', {}];
    },
    leave: () => {
      active = false;
      anchor.clear();
    },
    frame: () => {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback());
    },
    finish: () => {
      anchor.destroy();
      root.remove();
    },
  };
}

describe('visible receipt across width reflow', () => {
  it('repairs a lost receipt after two frames without changing focus', () => {
    const s = setup(),
      button = document.createElement('button');
    s.root.append(button);
    button.focus();
    s.observe(true);
    s.setTop(-100);
    s.resize(1100);
    s.frame();
    expect(s.scroll).not.toHaveBeenCalled();
    s.frame();
    expect(s.scroll).toHaveBeenCalledExactlyOnceWith({
      block: 'nearest',
      behavior: 'instant',
    });
    expect(document.activeElement).toBe(button);
    s.finish();
  });
  it('retains the old-width sample if IO reports false before the resize event', () => {
    const s = setup();
    s.observe(true);
    s.setWidth(1100);
    s.setTop(-100);
    s.observe(false);
    s.resize();
    s.frame();
    s.frame();
    expect(s.scroll).toHaveBeenCalledOnce();
    s.finish();
  });
  it('does not replace the frozen sample on repeated resize events', () => {
    const s = setup();
    s.observe(true);
    s.setTop(-100);
    s.resize(1100);
    s.observe(false);
    s.resize(1100);
    s.frame();
    s.frame();
    expect(s.scroll).toHaveBeenCalledOnce();
    s.finish();
  });
  it('keeps the frozen context while rapid width transitions cancel old frames', () => {
    const s = setup();
    s.observe(true);
    s.setTop(-100);
    s.resize(1100);
    s.frame();
    s.resize(1280);
    s.observe(false);
    s.frame();
    s.frame();
    expect(s.scroll).toHaveBeenCalledOnce();
    s.finish();
  });
  it('does nothing for height-only resize or a receipt that remains visible', () => {
    const s = setup();
    s.observe(true);
    s.resize();
    expect(s.frames.size).toBe(0);
    s.resize(1100);
    s.frame();
    s.frame();
    expect(s.scroll).not.toHaveBeenCalled();
    s.finish();
  });
  it('does not pull a previously offscreen receipt into view', () => {
    const s = setup();
    s.observe(false);
    s.setTop(-100);
    s.resize(1100);
    s.frame();
    s.frame();
    expect(s.scroll).not.toHaveBeenCalled();
    s.finish();
  });
  it.each(['before resize', 'during reflow'])(
    'does not reuse visibility for a replaced result %s',
    (when) => {
      const s = setup();
      s.observe(true);
      s.setTop(-100);
      if (when === 'before resize') s.setScope();
      s.resize(1100);
      if (when === 'during reflow') s.setScope();
      s.frame();
      s.frame();
      expect(s.scroll).not.toHaveBeenCalled();
      s.finish();
    },
  );
  it('does not scroll an inactive cached page or a disconnected receipt', () => {
    const s = setup();
    s.observe(true);
    s.setTop(-100);
    s.resize(1100);
    s.leave();
    s.frame();
    s.frame();
    expect(s.scroll).not.toHaveBeenCalled();
    s.finish();
    const t = setup();
    t.observe(true);
    t.setTop(-100);
    t.resize(1100);
    t.receipt.remove();
    t.frame();
    t.frame();
    expect(t.scroll).not.toHaveBeenCalled();
    t.finish();
  });
  it('cancels either pending frame and disconnects listeners on destruction', () => {
    for (const firstFrameDone of [false, true]) {
      const s = setup();
      s.observe(true);
      s.setTop(-100);
      s.resize(1100);
      if (firstFrameDone) s.frame();
      s.anchor.destroy();
      s.frame();
      s.frame();
      expect(s.frames.size).toBe(0);
      expect(s.scroll).not.toHaveBeenCalled();
      expect(s.unobserve).toHaveBeenCalledOnce();
      expect(s.unresize).toHaveBeenCalledOnce();
      s.root.remove();
    }
  });
});
