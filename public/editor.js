(function(global){
  const sizeClasses = {
    sm: 'm-editor-fs__sm',
    s: 'm-editor-fs__s',
    default: 'm-editor-fs__default',
    l: 'm-editor-fs__l',
    lg: 'm-editor-fs__lg'
  };

  const colorClasses = {
    gray: 'm-editor-fc__gray',
    blue1: 'm-editor-fc__blue-1',
    blue2: 'm-editor-fc__blue-2'
  };

  function wrapSelection(wrapper){
    const sel = global.getSelection ? global.getSelection() : null;
    if(!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const contents = range.extractContents();
    const node = wrapper(contents);
    range.insertNode(node);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function applySize(size){
    const cls = sizeClasses[size];
    if(!cls) return;
    wrapSelection(contents => {
      const span = global.document.createElement('span');
      span.className = cls;
      span.appendChild(contents);
      return span;
    });
  }

  function applyColor(color){
    const cls = colorClasses[color];
    if(!cls) return;
    wrapSelection(contents => {
      const span = global.document.createElement('span');
      span.className = cls;
      span.appendChild(contents);
      return span;
    });
  }

  function applyBold(){
    wrapSelection(contents => {
      const span = global.document.createElement('span');
      span.className = 'm-editor-fs__default';
      const strong = global.document.createElement('strong');
      strong.appendChild(contents);
      span.appendChild(strong);
      return span;
    });
  }

  function applyItalic(){
    wrapSelection(contents => {
      const span = global.document.createElement('span');
      span.className = 'm-editor-fs__default';
      const em = global.document.createElement('em');
      em.appendChild(contents);
      span.appendChild(em);
      return span;
    });
  }

  function insertPlaceholder(text){
    const sel = global.getSelection ? global.getSelection() : null;
    if(!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = global.document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  global.applySize = applySize;
  global.applyColor = applyColor;
  global.applyBold = applyBold;
  global.applyItalic = applyItalic;
  global.insertPlaceholder = insertPlaceholder;

  if (typeof module !== 'undefined') {
    module.exports = { applySize, applyColor, applyBold, applyItalic, insertPlaceholder };
  }
})(typeof window !== 'undefined' ? window : global);
