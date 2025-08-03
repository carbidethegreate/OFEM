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
  const placeholders = ['{parker_name}', '{username}', '{location}', '{name}', '[name]'];
  const tokens = [];
  let safeInput = input;
  placeholders.forEach((ph, i) => {
    const token = `__OFEM_PH_${i}__`;
    tokens.push({ token, ph });
    safeInput = safeInput.split(ph).join(token);
  });

  let sanitized = sanitizeHtml(safeInput, {
    allowedTags: ['span', 'strong', 'em', 'br'],
    allowedAttributes: {
      span: ['class']
    },
    allowedClasses: {
      span: allowedSpanClasses
    }
  });
  tokens.forEach(({ token, ph }) => {
    sanitized = sanitized.split(token).join(ph);
  });
  const withBreaks = sanitized.replace(/\r?\n/g, '<br>');
  return `<p>${withBreaks}</p>`;
}

module.exports = getEditorHtml;
module.exports.allowedSpanClasses = allowedSpanClasses;
