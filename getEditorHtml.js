const sanitizeHtml = require('sanitize-html');

function getEditorHtml(input) {
  const sanitized = sanitizeHtml(input, {
    allowedTags: sanitizeHtml.defaults.allowedTags.filter(tag => tag !== 'p'),
    allowedAttributes: sanitizeHtml.defaults.allowedAttributes
  });
  const withBreaks = sanitized.replace(/\r?\n/g, '<br>');
  return `<p>${withBreaks}</p>`;
}

module.exports = getEditorHtml;
