// 生成 app/assets/js/bg.js:内嵌 ogl + ReactBits「Aurora」背景组件(vanilla 移植)
// 来源:ogl@1.0.x (MIT, https://github.com/oframe/ogl) + react-bits Aurora.jsx (MIT, https://github.com/DavidHDev/react-bits)
// 用法:node tools/gen-aurora.js  (需先下载 ogl.js 到 .tmp-icons/)
const fs = require('fs');
const path = require('path');

const oglSrc = fs.readFileSync(path.join(__dirname, '..', '.tmp-icons', 'ogl.js'), 'utf8');
if (!oglSrc.startsWith("'use strict'")) throw new Error('ogl.js 源码不符,请重新下载 dist/ogl.js');

const vanilla = `
/* ═══ ReactBits「Aurora」背景组件 · vanilla 移植(忠实转译官方 Aurora.jsx) ═══
   默认参数与官方一致;新增 prefers-reduced-motion 静帧支持与手动销毁 */
(function () {
  var OGL = window.OGL;

  var VERT = '#version 300 es\\nin vec2 position;\\nvoid main() {\\n  gl_Position = vec4(position, 0.0, 1.0);\\n}\\n';

  var FRAG = __FRAG_SLOT__;

  function AuroraBackground(ctn, opts) {
    opts = opts || {};
    var colorStops = opts.colorStops || ['#5227FF', '#7cff67', '#5227FF'];
    var amplitude = opts.amplitude != null ? opts.amplitude : 1.0;
    var blend = opts.blend != null ? opts.blend : 0.5;
    var speed = opts.speed != null ? opts.speed : 1.0;

    var renderer = new OGL.Renderer({ alpha: true, premultipliedAlpha: true, antialias: true });
    var gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.backgroundColor = 'transparent';

    var program;
    var self = this;
    function resize() {
      var w = ctn.offsetWidth, h = ctn.offsetHeight;
      renderer.setSize(w, h);
      if (program) program.uniforms.uResolution.value = [w, h];
    }
    window.addEventListener('resize', resize);

    /* ogl 1.0 已移除 Triangle extras,用 Geometry 构建等价全屏三角形(顶点与官方 Triangle 一致) */
    var geometry = new OGL.Geometry(gl, {
      position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) }
    });

    program = new OGL.Program(gl, {
      vertex: VERT, fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: colorStops.map(function (hex) { var c = new OGL.Color(hex); return [c.r, c.g, c.b]; }) },
        uResolution: { value: [ctn.offsetWidth || 1, ctn.offsetHeight || 1] },
        uBlend: { value: blend },
        uLightMode: { value: opts.lightMode ? 1 : 0 }
      }
    });
    var mesh = new OGL.Mesh(gl, { geometry: geometry, program: program });
    ctn.appendChild(gl.canvas);

    var raf = 0;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function update(t) {
      program.uniforms.uTime.value = t * 0.001 * speed;
      renderer.render({ scene: mesh });
      if (!reduce) raf = requestAnimationFrame(update);
    }
    resize();
    raf = requestAnimationFrame(update);
    this.destroy = function () {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      if (gl.canvas.parentNode) gl.canvas.parentNode.removeChild(gl.canvas);
      renderer.gl.getExtension('WEBGL_lose_context') && renderer.gl.getExtension('WEBGL_lose_context').loseContext();
    };
  }

  window.EP = window.EP || {};
  EP.aurora = {
    mount: function (el, opts) {
      if (!el || !window.OGL) return null;
      try { return new AuroraBackground(el, opts); }            /* WebGL 不可用时静默降级为纯底色 */
      catch (e) { console.warn('Aurora 背景不可用,已降级纯色', e); return null; }
    }
  };
})();
`;

/* 从 Aurora.jsx 原文精确提取 FRAG shader(保持官方源码原样) */
const auroraJsx = fs.readFileSync(path.join(__dirname, '..', '.tmp-icons', 'Aurora.jsx'), 'utf8');
const m = auroraJsx.match(/const FRAG = `([\s\S]*?)`;\s*\n/);
if (!m) throw new Error('未能从 Aurora.jsx 提取 FRAG');
const FRAG = m[1];

const out = '/* bg.js — 首页「Aurora」动态背景(内嵌,零外部请求)\n' +
  '   · ogl (MIT) https://github.com/oframe/ogl · dist/ogl.js 完整内嵌\n' +
  '   · Aurora 组件 (MIT) https://github.com/DavidHDev/react-bits · 官方 Aurora.jsx vanilla 移植\n' +
  '   由 tools/gen-aurora.js 生成,请勿手改 */\n' +
  '(function(){var exports={},module={exports:exports};\n' + oglSrc + '\n' +
  'window.OGL={Renderer:exports.Renderer,Program:exports.Program,Mesh:exports.Mesh,Color:exports.Color,Geometry:exports.Geometry};})();\n' +
  vanilla.replace('__FRAG_SLOT__', JSON.stringify(FRAG));

fs.writeFileSync(path.join(__dirname, '..', 'app', 'assets', 'js', 'bg.js'), out);
console.log('bg.js 生成完成:', (out.length / 1024).toFixed(0) + 'KB, FRAG ' + FRAG.length + ' chars');
