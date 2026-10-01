/* storage.js — 方案 / 草稿 / AI 配置的本地持久化(localStorage,零后端) */
window.EP = window.EP || {};
EP.store = (function () {
  const K_PLANS = 'ep_plans', K_DRAFT = 'ep_draft', K_AI = 'ep_ai';

  function read(key, fb) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; }
    catch (e) { return fb; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.warn('localStorage 写入失败', e); return false; }
  }
  function genId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  return {
    /* ── 方案 CRUD(savePlan 返回 {saved:false} 表示持久化失败,内存对象仍返回) ──
       读取时顺手把旧版 plan.modules(十大固定模块)迁移为 plan.sections(模板引擎已移除) */
    getPlans() { return read(K_PLANS, []).map(p => (EP.struct ? EP.struct.migrate(p) : p)); },
    getPlan(id) { return this.getPlans().find(p => p.id === id) || null; },
    savePlan(plan) {
      plan.updatedAt = Date.now();
      const plans = this.getPlans();
      const idx = plans.findIndex(p => p.id === plan.id);
      if (idx >= 0) plans[idx] = plan; else plans.unshift(plan);
      plan.saved = write(K_PLANS, plans);           // 失败必须让调用方可见,不静默
      return plan;
    },
    deletePlan(id) { return write(K_PLANS, this.getPlans().filter(p => p.id !== id)); },
    copyPlan(id) {
      const src = this.getPlan(id); if (!src) return null;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = genId();
      copy.name = src.name + '(副本)';
      copy.createdAt = Date.now(); copy.status = 'active';
      /* 副本不继承撤销历史;getPlans 读取时已迁移,modules 分支为旧数据防御性保留 */
      (copy.modules ? Object.values(copy.modules) : []).forEach(m => { delete m.prev; });
      (copy.sections || []).forEach(s => { delete s.prev; });
      return this.savePlan(copy);
    },
    renamePlan(id, name) {
      const p = this.getPlan(id); if (!p) return;
      p.name = name.trim() || p.name; this.savePlan(p);
    },
    archivePlan(id, archived) {
      const p = this.getPlan(id); if (!p) return;
      p.status = archived ? 'archived' : 'active'; this.savePlan(p);
    },
    /* 首页列表:active/archived 两组 + 搜索/类型过滤 */
    listPlans(q, typeKey) {
      const kw = (q || '').trim().toLowerCase();
      const match = p =>
        (!kw || p.name.toLowerCase().includes(kw)) &&
        (!typeKey || p.type === typeKey);
      const all = this.getPlans().filter(match)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        active: all.filter(p => p.status !== 'archived'),
        archived: all.filter(p => p.status === 'archived')
      };
    },
    newId: genId,

    /* ── 向导草稿(刷新不丢已填内容;失败返回 false,草稿属便利性数据不告警) ── */
    saveDraft(form) { return write(K_DRAFT, form); },
    loadDraft() { return read(K_DRAFT, null); },
    clearDraft() { localStorage.removeItem(K_DRAFT); },

    /* ── AI 配置(仅存本地,不上传) ── */
    getAI() { return read(K_AI, { baseURL: '', apiKey: '', model: '' }); },
    setAI(cfg) { write(K_AI, cfg); }
  };
})();
