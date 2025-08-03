const { JSDOM } = require('jsdom');
const { clearStatusDots, resultsToCSV, setSendResults, getSendResults } = require('../public/results');

test('resultsToCSV generates CSV with header and rows', () => {
  setSendResults([
    { fanId: 1, username: 'user1', parkerName: 'p1', success: true },
    { fanId: 2, username: 'user2', parkerName: 'p2', success: false, error: 'oops' }
  ]);
  const csv = resultsToCSV();
  expect(csv).toBe(
    '"fanId","username","parkerName","success","error"\n' +
    '"1","user1","p1","success",""\n' +
    '"2","user2","p2","fail","oops"'
  );
});

test('clearStatusDots clears status cells and resets results', () => {
  const dom = new JSDOM('<span id="status-1">x</span><span id="status-2">y</span>');
  global.document = dom.window.document;
  setSendResults([{ fanId: 1 }, { fanId: 2 }]);
  clearStatusDots();
  expect(dom.window.document.getElementById('status-1').innerHTML).toBe('');
  expect(dom.window.document.getElementById('status-2').innerHTML).toBe('');
  expect(getSendResults()).toEqual([]);
});
