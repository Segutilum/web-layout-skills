export function stripMeta(html, httpEquiv) {
  const tagRe = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  return String(html).replace(tagRe, (tag) => {
    const m = tag.match(/\bhttp-equiv\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!m) return tag;
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    return value.toLowerCase() === String(httpEquiv).toLowerCase() ? '' : tag;
  });
}

export function buildBootstrap({ editorOrigin, runtimeToken }) {
  const config = JSON.stringify({ editorOrigin, runtimeToken });
  return '<script>window.__WEB_LAYOUT__=' + config + ';'
    + '(function(){try{Object.defineProperty(ServiceWorkerContainer.prototype,"register",'
    + '{value:function(){return Promise.reject(new Error("web-layout preview disables service workers"));}})}'
    + 'catch(e){}})();</script>';
}

export function injectPreviewHtml(html, { editorOrigin, runtimeToken }) {
  let out = stripMeta(html, 'content-security-policy');
  out = stripMeta(out, 'refresh');
  const bootstrap = buildBootstrap({ editorOrigin, runtimeToken });
  const head = /<head\b[^>]*>/i.exec(out);
  if (head) {
    out = out.slice(0, head.index + head[0].length) + bootstrap + out.slice(head.index + head[0].length);
  } else {
    out = bootstrap + out;
  }
  const runtime = '<script type="module" src="/__layout/runtime.js"></script>';
  if (out.includes('/__layout/runtime.js')) return out;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, runtime + '</body>');
  else out += runtime;
  return out;
}
