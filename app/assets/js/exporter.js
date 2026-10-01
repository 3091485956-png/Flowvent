/* exporter.js — Markdown 单文件导出 + A4 打印(公文排版,可另存 PDF)
   真 Word(.docx)导出见 word.js;所见即所得 PDF 见 pdf.js */
window.EP = window.EP || {};
EP.exporter = (function () {

  const CN = EP.struct.CN;

  /* 基本信息字段与取值统一由 EP.struct.metaRows 提供(单一事实源),此处只负责 Markdown 表格形态 */
  function metaLines(form) {
    return ['| 项目 | 内容 |', '| --- | --- |']
      .concat(EP.struct.metaRows(form).map(function (r) { return '| ' + r[0] + ' | ' + r[1] + ' |'; }))
      .join('\n');
  }

  function toMarkdown(plan) {
    const parts = ['# ' + plan.name, '', '> 本方案由秒策 · 企业活动策划工作台生成,结构标准、内容可编辑。', '', '## 方案基本信息', '', metaLines(plan.form)];
    (plan.sections || []).forEach(function (s, i) {
      parts.push('', '## ' + (CN[i] || i + 1) + '、' + s.title, '', s.md || '(待生成)');
    });
    parts.push('', '---', '', '生成时间:' + new Date(plan.updatedAt || Date.now()).toLocaleString('zh-CN'));
    return parts.join('\n');
  }

  function download(plan) {
    const md = toMarkdown(plan);
    const blob = new Blob(['\uFEFF' + md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (plan.name || '活动策划方案').replace(/[\\/:*?"<>|]/g, '_') + '.md';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 15000);   /* 6.1:大文件下载未完成即 revoke 会偶发取消,延长到 15s */
  }

  function buildPrintHtml(plan) {
    let html = '<div class="p-head"><div><h1>' + EP.md.esc(plan.name) + '</h1>' +
      '<div class="p-meta">组织单位:' + EP.md.esc(plan.form.company || '【待定】') +
      ' · 活动日期:' + EP.md.esc(plan.form.date || '【待定】') +
      ' · 参与人数:' + (plan.form.headcount || '【待定】') + ' 人</div></div>' +
      '<div class="p-seal">已核</div></div>';
    (plan.sections || []).forEach(function (s, i) {
      html += '<h2>' + (CN[i] || i + 1) + '、' + EP.md.esc(s.title) + '</h2>' + EP.md.render(s.md);
    });
    html += '<div class="p-foot"><span>秒策 · 企业活动策划工作台生成</span><span>' +
      new Date().toLocaleDateString('zh-CN') + '</span></div>';
    return html;
  }

  function print(plan) {
    const root = document.getElementById('print-root');
    root.innerHTML = buildPrintHtml(plan);
    root.hidden = false;
    setTimeout(function () { window.print(); root.hidden = true; }, 80);
  }

  return { toMarkdown: toMarkdown, download: download, print: print, buildPrintHtml: buildPrintHtml, metaLines: metaLines };
})();
