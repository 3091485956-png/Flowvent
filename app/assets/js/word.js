/* word.js — 真 .docx(Word 文档)导出,零依赖纯前端实现
   方案对齐 Ranuts Document 的"编辑成果即 Office 文档"能力:
   自实现 CRC32 + 仅 STORE 的 ZIP 打包器 + 最小 OOXML(wordprocessingml),
   标题层级/加粗/列表/引用/表格(含警示/合计/日期行着色)与网页预览同源同结构。
   测试钩子:EP.word._internals(crc32/zip/docXml)供 test/run.js 断言。 */
window.EP = window.EP || {};
EP.word = (function () {

  /* ───────── ZIP(STORE,不压缩;Word/WPS 均接受) ───────── */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;   // 固定时间戳:产物可复现,便于测试

  function zip(entries) {                                   // entries: [{name, data:Uint8Array}]
    const enc = new TextEncoder();
    const local = [], central = [];
    let offset = 0;
    entries.forEach(function (e) {
      const nameB = enc.encode(e.name);
      const crc = crc32(e.data);
      const head = new Uint8Array(30 + nameB.length);
      const dv = new DataView(head.buffer);
      dv.setUint32(0, 0x04034b50, true);                    // local file header
      dv.setUint16(4, 20, true);                            // version needed
      dv.setUint16(6, 0, true);                             // flags
      dv.setUint16(8, 0, true);                             // method: STORE
      dv.setUint16(12, DOS_DATE, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, e.data.length, true);
      dv.setUint32(22, e.data.length, true);
      dv.setUint16(26, nameB.length, true);
      head.set(nameB, 30);
      local.push(head, e.data);
      const cd = new Uint8Array(46 + nameB.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);                    // central directory header
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(12, DOS_DATE, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, e.data.length, true); cv.setUint32(24, e.data.length, true);
      cv.setUint16(28, nameB.length, true);
      cv.setUint32(42, offset, true);                       // local header 偏移
      cd.set(nameB, 46);
      central.push(cd);
      offset += head.length + e.data.length;
    });
    const cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cdSize + 22);
    let pos = 0;
    local.concat(central).forEach(function (ch) { out.set(ch, pos); pos += ch.length; });
    out.set(eocd, pos);
    return out;
  }

  /* ───────── OOXML ───────── */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function runs(text, opts) {
    /* **加粗** 行内标记 → 分段 run;opts.bold/italic 作用于普通段 */
    const o = opts || {};
    const out = [];
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach(function (part) {
      if (!part) return;
      const bold = o.bold || /^\*\*[^*]+\*\*$/.test(part);
      const t = bold ? part.slice(2, -2) : part;
      if (!t) return;
      const rpr = (bold ? '<w:b/>' : '') + (o.italic ? '<w:i/>' : '') +
        (o.color ? '<w:color w:val="' + o.color + '"/>' : '') +
        (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '');
      out.push('<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') +
        '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>');
    });
    return out.join('');
  }
  function p(text, opts) {
    const o = opts || {};
    const ppr = (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') +
      (o.ind ? '<w:ind w:left="' + o.ind + '" w:hanging="' + (o.hanging || 0) + '"/>' : '') +
      (o.border ? '<w:pBdr><w:left w:val="single" w:sz="18" w:space="4" w:color="000000"/></w:pBdr>' : '') +
      (o.jc ? '<w:jc w:val="' + o.jc + '"/>' : '') +
      (o.before || o.after ? '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after || 0) + '"/>' : '');
    return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + runs(text, o) + '</w:p>';
  }
  const ROW_BOLD = { warn: false, sum: true, day: true };   /* 朴素文档:去填充色,合计/分日行加粗 */
  function table(head, rows) {
    const cols = Math.max(head.length, 1);
    const w = Math.floor(8286 / cols);                      // A4 内容宽(11906-2×1418-2×60 边距)约 8290 dxa
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(function (e) { return '<w:' + e + ' w:val="single" w:sz="4" w:space="0" w:color="000000"/>'; }).join('');
    let x = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + borders + '</w:tblBorders>' +
      '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>' +
      '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid>' + Array(cols).fill('<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>';
    const cell = function (text, fill, bold) {
      return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' +
        (fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>' : '') + '</w:tcPr>' +
        p(text, { bold: bold, sz: 18 }) + '</w:tc>';
    };
    x += '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
      head.map(function (h) { return cell(h, '', true); }).join('') + '</w:tr>';
    rows.forEach(function (r) {
      x += '<w:tr>' + r.cells.map(function (c) { return cell(c, '', ROW_BOLD[r.cls] || false); }).join('') + '</w:tr>';
    });
    return x + '</w:tbl>';
  }

  /* ── Markdown(EP.md 子集)→ OOXML 块,与网页预览同一解析规则 ── */
  function blocksToXml(md) {
    const lines = String(md || '').split('\n');
    const out = [];
    let i = 0;
    const rowOf = function (line) {
      const m = line.match(/\{:(warn|sum|day)\}\s*$/);
      return {
        cls: m ? m[1] : '',
        cells: line.replace(/^\|/, '').replace(/\|?\s*\{:(warn|sum|day)\}\s*$/, '').split('|').map(function (c) { return c.trim(); })
      };
    };
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) { i++; continue; }
      if (/^####\s+/.test(t)) { out.push(p(t.replace(/^####\s+/, ''), { style: 'Heading3' })); i++; continue; }
      if (/^>\s?/.test(t)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
        out.push(p(buf.join(' '), { ind: 240, border: true, italic: true }));
        continue;
      }
      if (/^\|/.test(t)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
        if (rows.length >= 2 && /^[\s|:-]+$/.test(rows[1])) {
          out.push(table(rowOf(rows[0]).cells, rows.slice(2).map(rowOf)));
          out.push(p('', { sz: 8, after: 40 }));            // 表后空隙
        }
        continue;
      }
      if (/^[-*]\s+/.test(t)) {
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          out.push(p('• ' + lines[i].trim().replace(/^[-*]\s+/, ''), { ind: 420, hanging: 210 })); i++;
        }
        continue;
      }
      if (/^\d+[.、]\s+/.test(t)) {
        let n = 1;
        while (i < lines.length && /^\d+[.、]\s+/.test(lines[i].trim())) {
          out.push(p(n + '. ' + lines[i].trim().replace(/^\d+[.、]\s+/, ''), { ind: 420, hanging: 210 })); i++; n++;
        }
        continue;
      }
      out.push(p(t)); i++;
    }
    return out.join('');
  }

  function docXml(plan) {
    const S = EP.struct;
    let body = p(plan.name, { style: 'Title' }) +
      p([plan.form.date, plan.form.venue, (plan.form.headcount ? plan.form.headcount + ' 人' : ''),
        (plan.form.budgetTotal ? '预算 ¥' + Number(plan.form.budgetTotal).toLocaleString() : '')]
        .filter(Boolean).join(' · '), { jc: 'center', sz: 18, color: '595959', after: 160 }) +
      table(['项目', '内容'], S.metaRows(plan.form).map(function (r) { return { cells: r }; })) +
      p('', { sz: 8 });
    (plan.sections || []).forEach(function (s, idx) {
      body += p((S.CN[idx] || idx + 1) + '、' + s.title, { style: 'Heading1' }) + blocksToXml(s.md);
    });
    body += p('秒策生成 · ' + new Date().toLocaleDateString('zh-CN'), { jc: 'right', sz: 16, color: '808080' });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1418" w:bottom="1440" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="\u7b49\u7ebf" w:cs="Calibri"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/></w:pPr>' +
    '<w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="320" w:after="140"/></w:pPr>' +
    '<w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:outlineLvl w:val="2"/><w:spacing w:before="220" w:after="100"/></w:pPr>' +
    '<w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
    '</w:styles>';
  const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';
  const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  function build(plan) {
    const enc = new TextEncoder();
    return zip([
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
      { name: 'word/document.xml', data: enc.encode(docXml(plan)) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(DOC_RELS) },
      { name: 'word/styles.xml', data: enc.encode(STYLES) }
    ]);
  }
  function exportDocx(plan) {
    const bytes = build(plan);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (plan.name || '活动策划方案').replace(/[\\/:*?"<>|]/g, '_') + '.docx';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 15000);   /* 6.1:大文件下载未完成即 revoke 会偶发取消,延长到 15s */
    return bytes.length;
  }

  return {
    export: exportDocx, build: build, docXml: docXml,
    _internals: { crc32: crc32, zip: zip, esc: esc }
  };
})();
