/* md.js — 极简 Markdown 渲染器(标题/表格/列表/引用/加粗/段落)
   表格行尾支持 {:warn}|{:sum}|{:day} 标记 → 警示行/合计行/日期分隔行 */
window.EP = window.EP || {};
EP.md = (function () {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');   // 引号实体:文本节点解析回原字符,属性上下文防注入
  }
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
  function splitRow(line) {
    /* 两次替换各自独立:行首竖线与行尾「|{:标记}」必须都剥掉。
       曾用单次正则 ^\||\|…$ 交替,非全局 replace 只命中行首,导致 {:warn} 泄漏成末列单元格 */
    return line.replace(/^\|/, '')
      .replace(/\|\s*\{:(warn|sum|day)\}\s*$/, '')
      .replace(/\|$/, '')
      .split('|').map(c => c.trim());
  }
  function render(md) {
    const lines = String(md || '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { i++; continue; }

      if (/^####\s+/.test(t)) {                    // 小节标题
        out.push('<h4>' + inline(t.replace(/^####\s+/, '')) + '</h4>'); i++; continue;
      }
      if (/^>\s?/.test(t)) {                        // 引用
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
        out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>'); continue;
      }
      if (/^\|/.test(t)) {                          // 表格
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
        if (rows.length >= 2 && /^[\s|:-]+$/.test(rows[1])) {
          const head = splitRow(rows[0]);
          let html = '<div class="table-wrap"><table><thead><tr>' +
            head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>';
          for (let r = 2; r < rows.length; r++) {
            const m = rows[r].match(/\{:(warn|sum|day)\}\s*$/);
            const cls = m ? ' class="' + (m[1] === 'warn' ? 'warn-row' : m[1] === 'sum' ? 'sum-row' : 'day-divider') + '"' : '';
            const cells = splitRow(rows[r]);
            html += '<tr' + cls + '>' + cells.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
          }
          html += '</tbody></table></div>';
          out.push(html);
        }
        continue;
      }
      if (/^[-*]\s+/.test(t)) {                     // 无序列表
        const buf = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; }
        out.push('<ul>' + buf.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>'); continue;
      }
      if (/^\d+[.、]\s+/.test(t)) {                 // 有序列表
        const buf = [];
        while (i < lines.length && /^\d+[.、]\s+/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^\d+[.、]\s+/, '')); i++; }
        out.push('<ol>' + buf.map(x => '<li>' + inline(x) + '</li>').join('') + '</ol>'); continue;
      }
      out.push('<p>' + inline(t) + '</p>'); i++;     // 普通段落
    }
    /* 显示层符号 → 图标(⚠/✔ 仅转渲染,Markdown 源与导出仍为纯文本) */
    return out.join('\n')
      .replace(/\⚠/g, EP.icon('triangle-alert'))
      .replace(/\✔/g, EP.icon('circle-check'));
  }
  return { render: render, esc: esc };
})();
