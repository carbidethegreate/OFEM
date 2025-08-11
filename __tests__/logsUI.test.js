const { JSDOM } = require('jsdom');

describe('Activity logs UI', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('renderLogs outputs entries', () => {
    const dom = new JSDOM('<div id="logContainer"></div>');
    global.document = dom.window.document;
    const { renderLogs } = require('../public/logs');
    renderLogs([
      { time: '2025-01-01T00:00:00Z', level: 'info', msg: 'hello' },
      { time: '2025-01-01T01:00:00Z', level: 'error', msg: 'oops' },
    ]);
    const html = dom.window.document.getElementById('logContainer').innerHTML;
    expect(html).toContain('hello');
    expect(html).toContain('oops');
  });

  test('refresh fetches and renders logs', async () => {
    const dom = new JSDOM('<div id="logContainer"></div>');
    global.document = dom.window.document;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ logs: [{ time: 't', level: 'info', msg: 'hi' }] }),
    });
    const { refresh } = require('../public/logs');
    await refresh();
    expect(global.fetch).toHaveBeenCalledWith('/api/logs');
    expect(dom.window.document.getElementById('logContainer').textContent).toContain('hi');
  });
});
