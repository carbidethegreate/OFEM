/** @jest-environment jsdom */

describe('editor', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="toolbar">
        <select id="placeholderPicker">
          <option value="">Insert Placeholder</option>
          <option value="{parker_name}">{parker_name}</option>
          <option value="{username}">{username}</option>
          <option value="{location}">{location}</option>
        </select>
      </div>
      <div id="editor" contenteditable="true"></div>
    `;
    jest.resetModules();
    require('../public/js/editor.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  test('getEditorHtml preserves inserted placeholder', () => {
    const editor = document.getElementById('editor');
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const picker = document.getElementById('placeholderPicker');
    picker.value = '{username}';
    picker.dispatchEvent(new Event('change'));

    expect(window.getEditorHtml()).toContain('{username}');
  });
});
