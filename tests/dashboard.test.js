import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessions } = vi.hoisted(() => ({ getSessions: vi.fn() }));
vi.mock('../lib/storage.js', () => ({
  getSessions, getLatestSession: vi.fn(), deleteSession: vi.fn(),
  getStorageUsage: vi.fn(), getSetting: vi.fn(async () => undefined), saveSetting: vi.fn(),
}));
vi.mock('../lib/layout.js', () => ({
  initVirtualScroll: vi.fn(), setDensity: vi.fn(), getDensity: vi.fn(async () => 'comfortable'),
}));

// Reject HTML parsing at the DOM boundary; session values must remain literal text.
function element() {
  let text = '';
  return {
    children: [], style: {}, attributes: {}, hidden: true,
    classList: { toggle: vi.fn(), add: vi.fn() },
    set textContent(value) { text = String(value); this.children = []; },
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set innerHTML(_value) { throw new Error('Session data reached an HTML parser'); },
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    querySelector: () => element(), querySelectorAll: () => [], addEventListener: vi.fn(),
  };
}

let nodes, ready;
beforeEach(() => {
  vi.resetModules();
  nodes = new Map();
  vi.stubGlobal('document', {
    documentElement: element(), createElement: () => element(),
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    querySelector: () => element(),
    addEventListener(type, listener) { if (type === 'DOMContentLoaded') ready = listener; },
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ ok: true, result: { canUndo: false } })) } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render(session) {
  getSessions.mockResolvedValue([{ id: 'fixture', timestamp: 1, tabCount: 0, ...session }]);
  await import('../dashboard/app.js');
  await ready();
  expect(nodes.get('error-state').hidden).toBe(true);
  return nodes.get('groups-container').children;
}

describe('session HTML injection boundaries', () => {
  it('renders markup in a saved category and icon as literal text', async () => {
    const icon = '<img src=x onerror=alert(1)>';
    const category = '<a href="https://attacker.invalid">Category & notes</a>';
    const [card] = await render({ groups: [{ icon, category, tabs: [] }] });
    expect(card.children[0].children.map(child => child.textContent)).toEqual([icon, category, '0', '▼']);
  });

  it('renders saved window counts as literal text', async () => {
    const count = '<img src=x onerror=alert(1)>';
    const headers = await render({ groups: [], windowCount: 2, windows: [
      { windowId: 1, tabCount: count, groups: [] },
      { windowId: 2, tabCount: 0, groups: [] },
    ] });
    expect(headers[0].children.map(child => child.textContent)).toEqual(['🪟', 'Window', count + ' tabs']);
    expect(headers[1].children[2].textContent).toBe('0 tabs');
  });
});
