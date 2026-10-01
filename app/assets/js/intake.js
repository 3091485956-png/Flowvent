/* intake.js — 过往活动方案导入(docs/14:让 AI 从用户的历史成果中学习排版与风格)
   .docx:自实现 ZIP 目录解析(STORE 直读 / DEFLATE 经浏览器原生 DecompressionStream,零依赖)
   .pdf:按需加载 pdfjs-dist(CDN+SRI,与 Cytoscape 同模式)提取文本层
   .md/.txt:直读。提取的文本交 EP.ai.parsePastPlan 结构化,再经 EP.profile 入档。 */
window.EP = window.EP || {};
EP.intake = (function () {

  /* ── ZIP:仅定位并解压 word/document.xml ── */
  async function extractDocxText(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 22 || dv.getUint32(0, true) !== 0x04034b50) throw new Error('不是有效的 .docx 文件');
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65558); i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('docx 结构异常(未找到目录尾)');
    const dec = new TextDecoder();
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    let xml = null;
    for (let i = 0; i < count; i++) {
      if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const cmtLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
      if (name === 'word/document.xml') {
        const lNameLen = dv.getUint16(localOff + 26, true);
        const lExtraLen = dv.getUint16(localOff + 28, true);
        const start = localOff + 30 + lNameLen + lExtraLen;
        const comp = u8.subarray(start, start + compSize);
        xml = method === 0 ? dec.decode(comp) : dec.decode(await inflateRaw(comp));
        break;
      }
      off += 46 + nameLen + extraLen + cmtLen;
    }
    if (xml === null) throw new Error('docx 中未找到正文(word/document.xml)');
    return xmlToText(xml);
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压(需 Chrome 80+ / Edge)');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  /* OOXML → 纯文本:段落边界换行,标签剥除,实体还原 */
  function xmlToText(xml) {
    let s = String(xml).replace(/<w:tab[^>]*\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n');
    s = s.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
            .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ── PDF:按需加载 pdfjs-dist(SRI 固定,双源;离线明确报错) ── */
  const PDFJS_SOURCES = [
    { url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
      integrity: 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e' },
    { url: 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
      integrity: 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e' }
  ];
  let pdfLoading = false;
  function ensurePdfJs(cb) {
    if (window.pdfjsLib) return cb(true);
    if (pdfLoading) return;
    pdfLoading = true;
    const trySrc = function (i) {
      if (i >= PDFJS_SOURCES.length) { pdfLoading = false; cb(false); return; }
      const s = document.createElement('script');
      s.src = PDFJS_SOURCES[i].url;
      s.integrity = PDFJS_SOURCES[i].integrity;
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        pdfLoading = false;
        /* 取舍声明:Worker 脚本无法走 <script integrity> 校验(浏览器 Worker API 无 SRI 通道);
           workerSrc 与已校验的主脚本同源同版本(jsdelivr/unpkg 官方包),供应链面收窄至该路径 */
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_SOURCES[i].url.replace('pdf.min.js', 'pdf.worker.min.js');
        cb(true);
      };
      s.onerror = function () { s.remove(); trySrc(i + 1); };
      document.head.appendChild(s);
    };
    trySrc(0);
  }
  function extractPdfText(arrayBuffer) {
    return new Promise(function (resolve, reject) {
      ensurePdfJs(function (ok) {
        if (!ok) return reject(new Error('PDF 解析库加载失败(需联网);可将 PDF 另存为 .docx 后导入'));
        window.pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(function (pdf) {
          const pages = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            pages.push(pdf.getPage(i).then(function (page) {
              return page.getTextContent().then(function (tc) {
                return tc.items.map(function (it) { return it.str; }).join(' ');
              });
            }));
          }
          Promise.all(pages).then(function (texts) { resolve(texts.join('\n').trim()); })
            .catch(function (e) { reject(new Error('PDF 文本层解析失败:' + (e && e.message || e))); });
        }).catch(function () { reject(new Error('无法打开此 PDF(可能是扫描件/图片,无文本层)')); });
      });
    });
  }

  /* ── 统一入口:文件 → 文本(浏览器 File / 任意 ArrayBuffer) ── */
  async function extractText(file) {
    const name = (file.name || '').toLowerCase();
    const buf = file.arrayBuffer ? await file.arrayBuffer() : file;
    if (/\.docx$/.test(name)) return extractDocxText(buf);
    if (/\.pdf$/.test(name)) return extractPdfText(buf);
    if (/\.(md|txt)$/.test(name)) {
      const text = (await new Response(buf).text()).trim();
      /* 编码诚实性:GBK 等非 UTF-8 文本按 UTF-8 解码会产出大量 U+FFFD 替换符,
         把乱码喂给 AI 只会产出垃圾偏好 —— 明确报错优于静默解析 */
      const bad = (text.match(/\uFFFD/g) || []).length;
      if (bad > 0 && bad / Math.max(text.length, 1) > 0.02)
        throw new Error('文件编码可能不是 UTF-8(检测到大量乱码字符),请先另存为 UTF-8 再导入');
      return text;
    }
    throw new Error('暂不支持该格式(支持 .docx / .pdf / .md / .txt)');
  }

  return { extractDocxText: extractDocxText, extractPdfText: extractPdfText, extractText: extractText, xmlToText: xmlToText };
})();
