/* Safe Markdown renderer (escape first, then format). Supports headings, bold/italic, lists, quotes, links, inline code
 * and fenced code blocks with lightweight syntax highlighting and copy buttons. */
(function (A) {
  'use strict';
  const esc = A.util.esc;

  const KW = {
    python: 'def|return|if|elif|else|for|while|in|import|from|as|class|with|try|except|finally|raise|lambda|yield|async|await|None|True|False|and|or|not|pass|break|continue|print',
    javascript: 'const|let|var|function|return|if|else|for|while|of|in|class|new|import|from|export|default|async|await|try|catch|finally|throw|null|undefined|true|false|this|typeof|console',
    sql: 'select|from|where|join|left|right|inner|on|group|by|order|limit|insert|into|values|update|set|delete|create|table|and|or|not|as|count|sum|avg'
  };
  KW.js = KW.javascript; KW.ts = KW.typescript = KW.javascript; KW.py = KW.python;

  function highlight(code, lang) {
    const l = (lang || '').toLowerCase();
    const kw = KW[l];
    if (!kw) return esc(code);
    const kwSet = new Set(kw.split('|'));
    const comment = l === 'sql' ? '--[^\\n]*' : (KW[l] === KW.python ? '#[^\\n]*' : '\\/\\/[^\\n]*');
    const rx = new RegExp(`(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`[^\`]*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_]\\w*)\\b`, 'g');
    let out = '', last = 0, m;
    const span = (cls, t) => `<span class="tk-${cls}">${esc(t)}</span>`;
    while ((m = rx.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += span('c', m[1]);
      else if (m[2]) out += span('s', m[2]);
      else if (m[3]) out += span('n', m[3]);
      else {
        const w = m[4];
        if (kwSet.has(l === 'sql' ? w.toLowerCase() : w)) out += span('k', w);
        else if (code[rx.lastIndex] === '(') out += span('f', w);
        else out += esc(w);
      }
      last = rx.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#\/[^)\s]*)\)/g, (_, t, u) => `<a href="${u}"${u.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${t}</a>`);
  }

  function render(md) {
    const src = String(md || '').replace(/\r\n/g, '\n');
    const blocks = [];
    const withCode = src.replace(/```(\w+)?\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
      blocks.push({ lang: lang || '', code: code.replace(/\n$/, '') });
      return `\n\u0001${blocks.length - 1}\u0001\n`;
    });
    const lines = esc(withCode).split('\n');
    const out = [];
    let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };

    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if ((m = line.match(/^\u0001(\d+)\u0001$/))) {
        flushPara(); flushList();
        const b = blocks[+m[1]];
        out.push(`<div class="codeblock"><div class="cb-head"><span>${esc(b.lang || 'code')}</span><button class="cb-copy" data-copy-code>${A.icon('copy', 'sm')}<span>Копировать</span></button></div><pre><code>${highlight(b.code, b.lang)}</code></pre></div>`);
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flushPara(); flushList(); const lvl = Math.min(4, m[1].length + 1);
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]);
      } else if ((m = line.match(/^\s*&gt;\s?(.*)$/))) {
        flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      } else if (/^\s*$/.test(line)) {
        flushPara(); flushList();
      } else if (list && /^\s{2,}/.test(raw)) {
        list.items[list.items.length - 1] += '<br>' + line.trim();
      } else {
        flushList(); para.push(line);
      }
    }
    flushPara(); flushList();
    return out.join('');
  }

  /* Delegated handler for copy buttons inside rendered markdown */
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    const code = btn.closest('.codeblock').querySelector('code').innerText;
    const ok = await A.util.copy(code);
    A.ui.toast(ok ? 'Код скопирован' : 'Не удалось скопировать', ok ? 'success' : 'error');
  });

  A.markdown = { render, highlight };
})(window.Adis);
