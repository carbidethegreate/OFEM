const { JSDOM } = require('jsdom');
const {
  applyColor,
  applyBold,
  applySize,
  insertPlaceholder,
} = require('../public/editor');

function setupDom(html) {
  const dom = new JSDOM(html);
  global.window = dom.window;
  global.document = dom.window.document;
  global.getSelection = dom.window.getSelection.bind(dom.window);
  return dom;
}

function selectElement(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

test('applyColor inserts OnlyFans color class', () => {
  setupDom('<div id="msg">hello</div>');
  const el = document.getElementById('msg');
  selectElement(el);
  applyColor('blue1');
  expect(el.innerHTML).toBe('<span class="m-editor-fc__blue-1">hello</span>');
});

test('applyBold wraps selection with default span and strong', () => {
  setupDom('<div id="msg">hello</div>');
  const el = document.getElementById('msg');
  selectElement(el);
  applyBold();
  expect(el.innerHTML).toBe(
    '<span class="m-editor-fs__default"><strong>hello</strong></span>',
  );
});

test('applySize uses OnlyFans size class', () => {
  setupDom('<div id="msg">hello</div>');
  const el = document.getElementById('msg');
  selectElement(el);
  applySize('sm');
  expect(el.innerHTML).toBe('<span class="m-editor-fs__sm">hello</span>');
});

test('applySize supports new size classes', () => {
  setupDom('<div id="msg">hello</div>');
  const el = document.getElementById('msg');
  selectElement(el);
  applySize('s');
  expect(el.innerHTML).toBe('<span class="m-editor-fs__s">hello</span>');
});

test('applySize supports largest size class', () => {
  setupDom('<div id="msg">hello</div>');
  const el = document.getElementById('msg');
  selectElement(el);
  applySize('lg');
  expect(el.innerHTML).toBe('<span class="m-editor-fs__lg">hello</span>');
});

test('insertPlaceholder inserts text at caret', () => {
  setupDom('<div id="msg"></div>');
  const el = document.getElementById('msg');
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  insertPlaceholder('{username}');
  expect(el.innerHTML).toBe('{username}');
});
