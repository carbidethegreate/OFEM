const sanitizeHtml = require('sanitize-html');

const allowedSpanClasses = [
  'm-editor-fs__sm',
  'm-editor-fs__l',
  'm-editor-fs__default',
  'm-editor-fc__gray',
  'm-editor-fc__blue-1',
  'm-editor-fc__blue-2'
];

function getEditorHtml(input) {
  const sanitized = sanitizeHtml(input, {
    allowedTags: ['span', 'strong', 'em', 'br'],
    allowedAttributes: {
      span: ['class']
    },
    allowedClasses: {
      span: allowedSpanClasses
    }
  });
  const withBreaks = sanitized.replace(/\r?\n/g, '<br>');
  return `<p>${withBreaks}</p>`;
}

module.exports = getEditorHtml;
module.exports.allowedSpanClasses = allowedSpanClasses;
