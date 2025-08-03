function initEditor() {
  const boldBtn = document.getElementById('boldBtn');
  const colorPicker = document.getElementById('colorPicker');
  const sizePicker = document.getElementById('sizePicker');
  const placeholderPicker = document.getElementById('placeholderPicker');

  if (boldBtn) {
    boldBtn.addEventListener('click', () => document.execCommand('bold'));
  }
  if (colorPicker) {
    colorPicker.addEventListener('input', () => document.execCommand('foreColor', false, colorPicker.value));
  }
  if (sizePicker) {
    sizePicker.addEventListener('change', () => document.execCommand('fontSize', false, sizePicker.value));
  }
  if (placeholderPicker) {
    placeholderPicker.addEventListener('change', () => {
      insertPlaceholder(placeholderPicker.value);
      placeholderPicker.selectedIndex = 0;
    });
  }
}

function insertPlaceholder(text) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const scripts = template.content.querySelectorAll('script, style');
  scripts.forEach(el => el.remove());
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT, null, false);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    [...el.attributes].forEach(attr => {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    });
  }
  return template.innerHTML;
}

function getEditorHtml() {
  const editor = document.getElementById('editor');
  return sanitizeHtml(editor ? editor.innerHTML : '');
}

document.addEventListener('DOMContentLoaded', initEditor);

window.getEditorHtml = getEditorHtml;
