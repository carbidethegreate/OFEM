const { JSDOM } = require('jsdom');

describe('Message history UI', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('renderMessageHistory outputs messages', () => {
    const dom = new JSDOM('<div id="messageHistory"></div>');
    global.document = dom.window.document;
    const { renderMessageHistory } = require('../public/history');
    renderMessageHistory([
      { direction: 'incoming', body: 'hi' },
      { direction: 'outgoing', body: 'yo' },
    ]);
    const html = dom.window.document.getElementById('messageHistory').innerHTML;
    expect(html).toContain('<li><strong>incoming</strong>: hi</li>');
    expect(html).toContain('<li><strong>outgoing</strong>: yo</li>');
  });

  test('handleFetch fetches and renders history', async () => {
    const dom = new JSDOM(
      '<select id="fanSelect"><option value="1">F1</option></select><input id="limitInput" value="2"/><button id="fetchHistoryBtn"></button><div id="messageHistory"></div>',
    );
    global.document = dom.window.document;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          messages: [{ direction: 'incoming', body: 'hello' }],
        }),
    });
    const { handleFetch } = require('../public/history');
    await handleFetch();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/messages/history?fanId=1&limit=2',
    );
    expect(
      dom.window.document.getElementById('messageHistory').textContent,
    ).toContain('hello');
  });
});
