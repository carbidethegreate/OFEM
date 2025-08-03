const getEditorHtml = require('../getEditorHtml');

test('wraps content in a single paragraph', () => {
  expect(getEditorHtml('Hello world')).toBe('<p>Hello world</p>');
});

test('converts newlines to <br>', () => {
  expect(getEditorHtml('Line1\nLine2')).toBe('<p>Line1<br>Line2</p>');
});
