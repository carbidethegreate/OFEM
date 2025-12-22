const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function createDom() {
  const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'bulk_results.html'), 'utf8');
  const html = rawHtml.replace(/\\`/g, '`').replace(/\\\${/g, '${');
  const fetchQueue = [
    {
      ok: true,
      json: async () => ({
        items: [
          {
            id: 1,
            image_url: 'https://cdn.example/preview.jpg',
            caption: 'hello caption',
            schedule_time: '2024-07-01T10:00:00Z',
            timezone: 'UTC',
            destination: 'post',
            local_status: 'scheduled',
            post_status: null,
            message_status: null,
          },
        ],
      }),
    },
    { ok: true, json: async () => ({ globals: [] }) },
    {
      ok: true,
      json: async () => ({
        item: {
          id: 1,
          image_url: 'https://cdn.example/preview.jpg',
          caption: 'hello caption',
          schedule_time: '2024-07-01T10:00:00Z',
          timezone: 'UTC',
          destination: 'message',
          local_status: 'scheduled',
          post_status: null,
          message_status: null,
        },
      }),
    },
    { ok: true, json: async () => ({ globals: [] }) },
  ];

  const fetchMock = jest.fn(() =>
    Promise.resolve(fetchQueue.shift() || { ok: true, json: async () => ({}) }),
  );

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost/',
    beforeParse(window) {
      window.fetch = fetchMock;
    },
  });

  return { dom, fetchMock };
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('bulk_results UI', () => {
  test('renders schedule items and enforces destination exclusivity', async () => {
    const { dom, fetchMock } = createDom();
    await new Promise((resolve) => dom.window.addEventListener('load', resolve));
    await nextTick();

    const { document } = dom.window;
    const cards = document.querySelectorAll('.card');
    expect(cards.length).toBe(1);

    const activePills = cards[0].querySelectorAll('.destination-pill.active');
    expect(activePills.length).toBe(1);
    expect(activePills[0].textContent.toLowerCase()).toContain('post');

    const messagePill = Array.from(cards[0].querySelectorAll('.destination-pill')).find((pill) =>
      pill.textContent.toLowerCase().includes('message'),
    );
    messagePill.click();
    await nextTick();
    await nextTick();

    const refreshedCard = document.querySelector('.card');
    const pillStates = Array.from(refreshedCard.querySelectorAll('.destination-pill')).map(
      (pill) => ({
        text: pill.textContent.trim(),
        active: pill.classList.contains('active'),
      }),
    );

    expect(pillStates.filter((pill) => pill.active).length).toBe(1);
    expect(pillStates.find((pill) => pill.text.toLowerCase().includes('message')).active).toBe(
      true,
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/bulk-schedule/1'))).toBe(
      true,
    );

    dom.window.close();
  });
});
