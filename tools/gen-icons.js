// 生成 app/assets/js/icons.js:内嵌 Lucide(功能图标) + IconPark(模板双色图标)
// 用法:node gen-icons.js   (资产以 MIT/ISC 许可内嵌,来源注释保留)
const fs = require('fs');
const path = require('path');

const LUCIDE = ['settings', 'plus', 'sparkles', 'arrow-right', 'undo-2', 'check', 'pencil',
  'refresh-cw', 'list-minus', 'copy', 'download', 'printer', 'archive', 'archive-restore',
  'trash-2', 'search', 'calendar', 'users', 'map-pin', 'wallet', 'triangle-alert',
  'circle-check', 'text', 'wand-sparkles', 'folder-open', 'x'];
// IconPark:产品模板标识图标(键 = 'tpl-'+pack.key,pack.key 为下划线命名)
const ICONPARK = {
  'tpl-team_building': 'Tent',
  'tpl-birthday': 'BirthdayCake',
  'tpl-annual_gala': 'Fireworks',
  'tpl-client_salon': 'CooperativeHandshake',
  'tpl-product_launch': 'Rocket',
  'tpl-training': 'Classroom',
  'tpl-festival': 'PartyBalloon',
  'tpl-outdoor': 'Mountain'
};
// IconPark two-tone 主题色(企业蓝系)
const PROPS = {
  size: '48', strokeWidth: '4', strokeLinecap: 'round', strokeLinejoin: 'round',
  colors: ['#0B2B66', '#1444C4', '#0B2B66', '#1444C4']
};

function fetchSync(url) {
  const cp = require('child_process');
  const file = path.join(__dirname, '.cache-' + Math.random().toString(36).slice(2));
  cp.execSync(`curl -sL --max-time 20 "${url}" -o "${file}"`, { stdio: 'pipe' });
  const data = fs.readFileSync(file, 'utf8');
  fs.unlinkSync(file);
  return data;
}

const out = {};

/* ── Lucide ── */
for (const name of LUCIDE) {
  const raw = fetchSync(`https://unpkg.com/lucide-static@1.49.0/icons/${name}.svg`);
  const cleaned = raw.replace(/<!--[\s\S]*?-->\s*/g, '').replace(/\s+/g, ' ').replace(/\s>/g, '>').trim();
  if (cleaned.startsWith('<svg')) {
    out[name] = cleaned;
  } else {
    console.error('LUCIDE MISS:', name, JSON.stringify(cleaned.slice(0, 60)));
  }
}

/* ── IconPark(注入 two-tone 双色,静态化 SVG) ── */
for (const [key, pascal] of Object.entries(ICONPARK)) {
  let src = fetchSync(`https://unpkg.com/@icon-park/svg@1.4.2/es/icons/${pascal}.js`);
  if (src.startsWith('Not found')) { console.error('ICONPARK MISS:', pascal); continue; }
  // 去掉 import/export,注入本地 IconWrapper 求值
  const code = 'function IconWrapper(n, fn){ return fn(PROPS); }\n' +
    src.replace(/^import[^\n]*\n/m, '').replace(/export default\s*/, 'module.exports.__icon =');
  const sandbox = { module: { exports: {} }, PROPS };
  new Function('module', 'PROPS', code)(sandbox.module, PROPS);
  let svg = sandbox.module.exports.__icon;
  svg = svg.replace(/^<\?xml[^>]*\?>\s*/, '')
           .replace('width="48" height="48"', 'width="48" height="48" style="display:block"')
           .replace(/\s+/g, ' ').trim();
  out[key] = svg;
}

/* ── 写 icons.js ── */
const banner = `/* icons.js — 内嵌图标资产(离线可用,零外部请求)
   · Lucide v1.49.0 · ISC License · https://lucide.dev  (stroke 图标,继承 currentColor)
   · IconPark @icon-park/svg v1.4.2 · MIT License · https://iconpark.oceanengine.com
     (模板标识图标,two-tone 双色:描边 #0B2B66 / 填充 #1444C4)
   用法:EP.icon('settings') 返回 <span class="icon">…</span>;静态 HTML 用 <i data-icon="settings"></i>,init 时 mount */
`;
const body = 'window.EP = window.EP || {};\nEP.icons = ' + JSON.stringify(out, null, 1) + ';\n' +
`EP.icon = function (name, cls) {
  var svg = EP.icons[name] || '';
  return '<span class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + svg + '</span>';
};
EP.mountIcons = function (root) {
  (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
    if (el.dataset.iconDone) return;
    el.innerHTML = EP.icons[el.dataset.icon] || '';
    el.classList.add('icon');
    el.setAttribute('aria-hidden', 'true');   // 装饰性图标对读屏隐藏
    el.dataset.iconDone = '1';
  });
};
`;
fs.writeFileSync(path.join(__dirname, '..', 'app', 'assets', 'js', 'icons.js'), banner + body);
console.log('OK —', Object.keys(out).length, 'icons embedded:', Object.keys(out).join(', '));
