const getEditorHtml = require('../getEditorHtml');

test('wraps content in a single paragraph', () => {
  expect(getEditorHtml('Hello world')).toBe('<p>Hello world</p>');
});

test('converts newlines to <br>', () => {
  expect(getEditorHtml('Line1\nLine2')).toBe('<p>Line1<br>Line2</p>');
});

test('allows OnlyFans span classes', () => {
  const html = '<span class="m-editor-fs__l m-editor-fc__blue-2">Hi</span>';
  expect(getEditorHtml(html)).toBe('<p><span class="m-editor-fs__l m-editor-fc__blue-2">Hi</span></p>');
});

test('strips disallowed tags and classes', () => {
  const html = '<div class="x">Bad</div><span class="bad">Nope</span>';
  expect(getEditorHtml(html)).toBe('<p>Bad<span>Nope</span></p>');
});

test('preserves placeholders', () => {
  const str = '{parker_name} {username} {location} {name} [name]';
  expect(getEditorHtml(str)).toBe('<p>{parker_name} {username} {location} {name} [name]</p>');
});
