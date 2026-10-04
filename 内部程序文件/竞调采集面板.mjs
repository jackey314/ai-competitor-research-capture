import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncCaptureToFeishu } from './飞书竞调同步.mjs';

function safeName(value, fallback = '未命名竞品') {
  const cleaned = String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function shortText(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function clampUnit(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function normalizeAnnotations(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item, index) => ({
    id: shortText(item?.id, 24) || `A${index + 1}`,
    x: clampUnit(item?.x),
    y: clampUnit(item?.y),
    note: shortText(item?.note, 300),
  }));
}

function normalizeStyleSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const cleanMap = (source, keys) => Object.fromEntries(keys.map((key) => [key, shortText(source?.[key], 120)]).filter(([, item]) => item));
  const snapshot = {
    selector: shortText(value.selector, 240),
    tagName: shortText(value.tagName, 40),
    text: shortText(value.text, 180),
    capturedAt: shortText(value.capturedAt, 48),
    rect: cleanMap(value.rect, ['width', 'height', 'x', 'y']),
    typography: cleanMap(value.typography, ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'textAlign']),
    spacing: cleanMap(value.spacing, ['padding', 'margin', 'gap']),
    surface: cleanMap(value.surface, ['display', 'backgroundColor', 'border', 'borderRadius', 'boxShadow']),
  };
  return snapshot.selector || snapshot.tagName ? snapshot : null;
}

function normalizeUXEvidence(value) {
  const allowedStates = new Set(['常规', '加载中', '成功', '失败', '缺省', '无权限', '禁用']);
  const state = allowedStates.has(value?.state) ? value.state : '常规';
  const evidence = {
    state,
    trigger: shortText(value?.trigger, 240),
    feedback: shortText(value?.feedback, 500),
    recovery: shortText(value?.recovery, 300),
    accessibility: shortText(value?.accessibility, 300),
  };
  return Object.values(evidence).some(Boolean) ? evidence : null;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function openPath(targetPath) {
  return new Promise((resolve) => execFile('open', [targetPath], () => resolve()));
}

function timestampLabel() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function createEmptyIndex(session, displayName) {
  return {
    type: 'competitor-research-capture-library',
    version: 1,
    session,
    displayName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    captures: [],
  };
}

async function writeLibraryFiles(library) {
  library.index.updatedAt = new Date().toISOString();
  await writeJson(library.indexPath, library.index);
  const rows = library.index.captures.map((capture) => [
    `| ${capture.id} | ${capture.name} | ${capture.module || '—'} | ${capture.finalUrl} | ${capture.note || '—'} |`,
    `\n![${capture.id} ${capture.name}](${capture.screenshot})`,
  ].join('\n'));
  const markdown = [
    `# ${library.index.displayName}｜截图入库索引`,
    '',
    `更新时间：${timestampLabel()}`,
    '',
    '| 编号 | 页面名称 | 模块 | 页面地址 | 备注 |',
    '|---|---|---|---|---|',
    ...(rows.length ? rows : ['| — | 暂无截图 | — | — | — |']),
    '',
    '每张图片对应 `metadata/` 中的 JSON，可保存页面名称、模块、备注和用户标注点。',
    '',
  ].join('\n');
  await fs.writeFile(library.markdownPath, markdown, 'utf8');
  const feishuRows = library.index.captures.map((capture) => [
    capture.id,
    capture.module || capture.name || '—',
    capture.userTask || '待补充',
    `[${capture.filename}](${capture.screenshot})`,
    capture.observation || capture.note || '待分析',
    capture.analysis || '待分析',
    capture.evidenceLevel || 'A',
    capture.toVerify || '待补充',
  ].map((value) => String(value).replace(/\|/g, '／')).join(' | '));
  const feishuMarkdown = [
    `# ${library.index.displayName}｜飞书待同步表`,
    '',
    '> 字段与飞书竞调表保持一致。截图列保存原图路径；同步到飞书时将替换为图片附件。',
    '',
    '| 编号 | 模块/路径 | 用户任务 | 截图 | 观察事实 | 分析解读 | 证据等级 | 待验证 |',
    '|---|---|---|---|---|---|---|---|',
    ...(feishuRows.length ? feishuRows.map((row) => `| ${row} |`) : ['| — | — | — | — | — | — | — | — |']),
    '',
  ].join('\n');
  await fs.writeFile(path.join(library.directory, '飞书待同步.md'), feishuMarkdown, 'utf8');
}

async function writeFigmaSpecFile(library, capture) {
  const specDir = path.join(library.directory, 'Figma标注');
  await fs.mkdir(specDir, { recursive: true });
  const spec = normalizeStyleSnapshot(capture.styleSnapshot);
  const rows = (group) => Object.entries(group || {}).filter(([, value]) => value).map(([key, value]) => `- ${key}: ${value}`);
  const markdown = [
    `# ${capture.id}｜${capture.name}｜Figma 标注`,
    '',
    `- 截图：\`${capture.screenshot}\``,
    `- 页面：${capture.finalUrl}`,
    `- 模块：${capture.module || '—'}`,
    `- 用户任务：${capture.userTask || '—'}`,
    '',
    '## 调研内容',
    `- 观察事实：${capture.observation || '待补充'}`,
    `- 分析解读：${capture.analysis || '待补充'}`,
    `- 待验证：${capture.toVerify || '待补充'}`,
    '',
    '## UX 状态证据',
    `- 状态：${capture.uxEvidence?.state || '未记录'}`,
    `- 触发动作与用户期待：${capture.uxEvidence?.trigger || '待补充'}`,
    `- 可见反馈 / 状态文案：${capture.uxEvidence?.feedback || '待补充'}`,
    `- 恢复路径 / 下一步：${capture.uxEvidence?.recovery || '待补充'}`,
    `- 可访问性线索：${capture.uxEvidence?.accessibility || '待补充'}`,
    '',
    '## 点选元素的视觉规格',
    spec ? `- 选择器：\`${spec.selector}\`` : '- 尚未读取元素样式。请在网页右下角的“读取 UI 数值”中点选元素。',
    ...(spec?.tagName ? [`- 元素：${spec.tagName}${spec.text ? ` · ${spec.text}` : ''}`] : []),
    ...(spec ? ['', '### 尺寸与位置', ...rows(spec.rect), '', '### 文字', ...rows(spec.typography), '', '### 间距', ...rows(spec.spacing), '', '### 容器与表面', ...rows(spec.surface)] : []),
    '',
    '> 将截图拖入 Figma 后，可把这份标注中的数值作为图层命名、说明或设计变量的依据。',
    '',
  ].join('\n');
  const specName = `${capture.id}-${safeName(capture.name)}-Figma标注.md`;
  await fs.writeFile(path.join(specDir, specName), markdown, 'utf8');
  capture.figmaSpec = `Figma标注/${specName}`;
}

function panelScript(defaults = {}) {
  const defaultsJson = JSON.stringify({
    session: defaults.session || '',
    taskId: defaults.taskId || '',
    userTask: defaults.userTask || '',
    module: defaults.module || '',
  });
  return `(() => {
    if (window.__codexResearchCapturePanelInstalled) return;
    window.__codexResearchCapturePanelInstalled = true;

    const host = document.createElement('div');
    host.id = 'codex-research-capture-host';
    host.dataset.captureHidden = 'false';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = \
      '<style>' +
      ':host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033}' +
      ':host([data-capture-hidden="true"]){display:none!important}' +
      'button,input,textarea,select{font:inherit;box-sizing:border-box}.trigger{min-width:92px;height:44px;border:0;border-radius:22px;background:#171717;color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.25);font-size:13px;font-weight:700;padding:0 16px;cursor:pointer}.trigger:focus-visible,.panel button:focus-visible,.panel input:focus-visible,.panel textarea:focus-visible,.panel select:focus-visible,.advanced summary:focus-visible{outline:3px solid #8b5cf6;outline-offset:2px}.panel{position:absolute;right:0;bottom:56px;width:370px;max-height:calc(100vh - 100px);overflow:auto;border:1px solid #d9dce5;border-radius:16px;background:#fff;box-shadow:0 16px 48px rgba(16,24,40,.22);padding:16px;display:none}.panel[data-open="true"]{display:block}.head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}.head h2{font-size:16px;line-height:22px;margin:0}.head p{font-size:12px;color:#667085;margin:3px 0 0}.close{border:0;background:transparent;font-size:22px;line-height:24px;color:#667085;cursor:pointer}.field{display:grid;gap:5px;margin-top:12px}.field label{font-size:12px;font-weight:650;color:#344054}.field input,.field textarea,.field select{border:1px solid #cfd4df;border-radius:8px;padding:8px 10px;color:#172033;background:#fff}.field textarea{min-height:60px;resize:vertical}.primary{width:100%;border:0;border-radius:9px;padding:10px 12px;margin-top:14px;background:#171717;color:#fff;font-weight:700;cursor:pointer}.secondary{border:1px solid #cfd4df;border-radius:8px;background:#fff;padding:7px 9px;color:#344054;cursor:pointer}.hint,.status{font-size:12px;line-height:18px;color:#667085;margin:10px 0 0}.status[aria-live]{min-height:18px}.preview{display:none;margin-top:14px;border-top:1px solid #eaecf0;padding-top:14px}.preview[data-visible="true"]{display:block}.stage{position:relative;margin-top:8px;border:1px solid #d9dce5;border-radius:10px;overflow:hidden;background:#f2f4f7;cursor:crosshair}.stage img{display:block;width:100%;height:auto}.pin{position:absolute;width:22px;height:22px;border-radius:50%;border:2px solid #fff;background:#7c3aed;color:#fff;font-size:11px;font-weight:800;line-height:18px;text-align:center;transform:translate(-50%,-50%);box-shadow:0 2px 7px rgba(0,0,0,.28);pointer-events:none}.annotation-list{display:grid;gap:8px;margin-top:10px}.annotation{display:grid;grid-template-columns:32px 1fr 28px;gap:6px;align-items:center}.annotation span{font-size:12px;font-weight:700;color:#7c3aed}.annotation input{min-width:0;padding:6px 8px;font-size:12px}.annotation button{border:0;background:transparent;color:#b42318;font-size:18px;cursor:pointer}.actions{display:flex;gap:8px;margin-top:12px}.actions button{flex:1}.actions .save{border:0;border-radius:8px;background:#7c3aed;color:#fff;padding:8px;font-weight:700;cursor:pointer}.advanced{margin-top:14px;border-top:1px solid #eaecf0;padding-top:12px}.advanced summary{cursor:pointer;font-size:12px;font-weight:700;color:#344054}.inspector{display:none;position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #7c3aed;background:rgba(124,58,237,.10);box-sizing:border-box}.inspector[data-visible="true"]{display:block}.spec{margin-top:10px;padding:9px;border:1px solid #e4e7ec;border-radius:8px;background:#f8fafc;font-size:11px;line-height:17px;color:#344054;white-space:pre-wrap}' +
      '@media (prefers-reduced-motion: reduce){*,*::before,*::after{transition:none!important;animation:none!important}}' +
      '</style>' +
      '<button class="trigger" id="trigger" type="button" aria-label="打开竞调截图入库面板" title="竞调截图入库">截图入库</button>' +
      '<section class="panel" id="panel" aria-label="竞调截图入库" data-open="false">' +
      '<div class="head"><div><h2>截图入库</h2><p>截图会保存到当前竞品素材库。</p></div><button class="close" id="close" type="button" aria-label="关闭截图入库面板">×</button></div>' +
      '<div class="field"><label for="session">竞品 / 调研名称</label><input id="session" maxlength="60" /></div>' +
      '<div class="field"><label for="task">用户任务</label><input id="task" maxlength="160" placeholder="例如：确认剧本设定的编辑方式" /></div>' +
      '<div class="field"><label for="name">页面名称</label><input id="name" maxlength="100" /></div>' +
      '<div class="field"><label for="module">模块</label><input id="module" maxlength="80" placeholder="例如：分镜编辑" /></div>' +
      '<div class="field"><label for="note">页面备注 / 路径</label><textarea id="note" maxlength="300" placeholder="记录当前路径、功能名称或上下文"></textarea></div>' +
      '<button class="primary" id="capture" type="button">截图并预览</button><p class="hint">截图时采集面板会自动隐藏，不会出现在图片中。</p><p class="status" id="status" aria-live="polite"></p>' +
      '<div class="preview" id="preview"><strong>截图已保存</strong><p class="hint">先生成草稿，再按实际页面核对；需要时再展开完整研究与 UX 字段。</p><div class="stage" id="stage"><img id="image" alt="刚采集的页面截图预览" /><div id="pins"></div></div><div class="annotation-list" id="annotations"></div><button class="primary" id="draft" type="button">生成分析草稿</button><p class="hint">当前为本地结构化草稿；连接视觉模型后可升级为直接看图分析。</p><details class="advanced" id="advanced"><summary>补充研究与 UX 细节（可选）</summary><div class="field"><label for="observation">观察事实</label><textarea id="observation" maxlength="500" placeholder="只描述画面中可直接确认的事实"></textarea></div><div class="field"><label for="analysis">分析解读</label><textarea id="analysis" maxlength="500" placeholder="基于事实的产品判断；避免把猜测写成事实"></textarea></div><div class="field"><label for="verify">待验证</label><textarea id="verify" maxlength="300" placeholder="下一步需进入何处、验证什么"></textarea></div><div class="field"><label for="ux-state">UX 状态</label><select id="ux-state" aria-label="UX 状态"><option>常规</option><option>加载中</option><option>成功</option><option>失败</option><option>缺省</option><option>无权限</option><option>禁用</option></select></div><div class="field"><label for="ux-trigger">触发动作与用户期待</label><textarea id="ux-trigger" maxlength="240" placeholder="例如：点击生成，期待看到进度和可取消入口"></textarea></div><div class="field"><label for="ux-feedback">可见反馈 / 状态文案</label><textarea id="ux-feedback" maxlength="500" placeholder="原样记录文案、图标、进度、骨架或错误提示"></textarea></div><div class="field"><label for="ux-recovery">恢复路径 / 下一步</label><textarea id="ux-recovery" maxlength="300" placeholder="例如：重试、返回上一步、联系客服或创建第一条内容"></textarea></div><div class="field"><label for="ux-accessibility">可访问性线索（可选）</label><textarea id="ux-accessibility" maxlength="300" placeholder="例如：状态是否只靠颜色；按钮文字是否说明操作"></textarea></div><div class="actions"><button class="secondary" id="inspect" type="button">读取 UI 数值</button><button class="save" id="save" type="button">保存补充</button></div><p class="hint" id="inspect-hint">点击“读取 UI 数值”后，再点网页中的任一元素；不会触发该网页操作。</p><div class="spec" id="spec" hidden></div></details><div class="actions"><button class="secondary" id="open-library" type="button">打开素材库</button><button class="save" id="save-main" type="button">保存</button></div><button class="primary" id="sync" type="button">确认并同步到飞书</button></div>' +
      '</section>';

    const toast = document.createElement('div');
    toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
    Object.assign(toast.style, { display: 'none', position: 'absolute', right: '0', bottom: 'calc(100% + 14px)', width: '300px', padding: '11px 13px', borderRadius: '10px', color: '#fff', fontSize: '12px', lineHeight: '18px', boxShadow: '0 12px 30px rgba(16,24,40,.28)', background: '#027a48' });
    root.appendChild(toast);

    const mount = () => {
      const target = document.body || document.documentElement;
      if (target && !host.isConnected) target.appendChild(host);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
    // SPA 在首屏加载后可能替换 body/根容器；检测到面板被移除时立刻重新挂载。
    const keepMounted = () => mount();
    const observeMount = () => { if (document.documentElement) new MutationObserver(keepMounted).observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.documentElement) observeMount();
    else document.addEventListener('DOMContentLoaded', observeMount, { once: true });
    setInterval(keepMounted, 800);
    const $ = (id) => root.getElementById(id);
    const trigger = $('trigger'); const panel = $('panel'); const close = $('close');
    const session = $('session'); const task = $('task'); const name = $('name'); const module = $('module'); const note = $('note');
    const capture = $('capture'); const status = $('status'); const preview = $('preview'); const image = $('image');
    const stage = $('stage'); const pins = $('pins'); const annotations = $('annotations'); const save = $('save'); const saveMain = $('save-main'); const sync = $('sync'); const openLibrary = $('open-library'); const advanced = $('advanced');
    const observation = $('observation'); const analysis = $('analysis'); const verify = $('verify'); const draft = $('draft'); const inspect = $('inspect'); const inspectHint = $('inspect-hint'); const spec = $('spec');
    const uxState = $('ux-state'); const uxTrigger = $('ux-trigger'); const uxFeedback = $('ux-feedback'); const uxRecovery = $('ux-recovery'); const uxAccessibility = $('ux-accessibility');
    const highlight = document.createElement('div'); highlight.className = 'inspector'; root.appendChild(highlight);
    let current = null; let marks = []; let toastTimer; let inspectMode = false; let selectedStyle = null;
    const taskDefaults = ${defaultsJson};
    const savedSession = (() => { try { return window.localStorage.getItem('__codexResearchSession'); } catch { return ''; } })();
    session.value = savedSession || taskDefaults.session || window.location.hostname || '未命名竞品';
    task.value = taskDefaults.userTask || '';
    module.value = taskDefaults.module || '';
    session.addEventListener('input', () => { try { window.localStorage.setItem('__codexResearchSession', session.value); } catch {} });

    const setStatus = (message) => { status.textContent = message || ''; };
    const showToast = (message, type = 'success') => { const colors = { success: '#027a48', warning: '#9a6700', error: '#b42318' }; toast.textContent = message; toast.style.background = colors[type] || colors.success; toast.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 5200); };
    const openPanel = () => { panel.dataset.open = 'true'; trigger.setAttribute('aria-expanded', 'true'); name.focus(); };
    const closePanel = () => { panel.dataset.open = 'false'; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); };
    const cleanName = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const isPanelTarget = (target) => target === host || target?.getRootNode?.() === root || target?.closest?.('#codex-research-capture-host');
    const number = (value) => Math.round(Number(value) * 10) / 10;
    const selectorFor = (element) => {
      if (element.id) return '#' + CSS.escape(element.id);
      const parts = [];
      let node = element;
      while (node && node.nodeType === 1 && parts.length < 4) {
        let part = node.tagName.toLowerCase();
        const stableClass = Array.from(node.classList || []).find((item) => /^[a-z][a-z0-9_-]{1,30}$/i.test(item) && !/^(active|selected|hover|focus)$/i.test(item));
        if (stableClass) part += '.' + CSS.escape(stableClass);
        else if (node.parentElement) { const siblings = Array.from(node.parentElement.children).filter((item) => item.tagName === node.tagName); if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'; }
        parts.unshift(part); if (node.id) break; node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const snapshotElement = (element) => {
      const styles = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return { selector: selectorFor(element), tagName: element.tagName.toLowerCase(), text: cleanName(element.innerText || element.getAttribute('aria-label') || element.alt || '').slice(0, 180), capturedAt: new Date().toISOString(), rect: { width: number(rect.width) + 'px', height: number(rect.height) + 'px', x: number(rect.x) + 'px', y: number(rect.y) + 'px' }, typography: { fontFamily: styles.fontFamily, fontSize: styles.fontSize, fontWeight: styles.fontWeight, lineHeight: styles.lineHeight, letterSpacing: styles.letterSpacing, color: styles.color, textAlign: styles.textAlign }, spacing: { padding: styles.padding, margin: styles.margin, gap: styles.gap }, surface: { display: styles.display, backgroundColor: styles.backgroundColor, border: styles.border, borderRadius: styles.borderRadius, boxShadow: styles.boxShadow } };
    };
    const renderSpec = () => {
      if (!selectedStyle) { spec.hidden = true; spec.textContent = ''; return; }
      const { typography, spacing, surface, rect } = selectedStyle;
      spec.textContent = '已读取：' + selectedStyle.tagName + '  ' + selectedStyle.selector + '\\n尺寸 ' + rect.width + ' × ' + rect.height + ' · 字号 ' + typography.fontSize + ' · 行高 ' + typography.lineHeight + '\\n内边距 ' + spacing.padding + ' · 圆角 ' + surface.borderRadius + ' · 间距 ' + spacing.gap;
      spec.hidden = false;
    };
    const clearInspect = () => { inspectMode = false; highlight.dataset.visible = 'false'; inspect.textContent = '读取 UI 数值'; inspectHint.textContent = '点击“读取 UI 数值”后，再点网页中的任一元素；不会触发该网页操作。'; };
    const onInspectMove = (event) => { if (!inspectMode || isPanelTarget(event.target)) return; const rect = event.target.getBoundingClientRect(); Object.assign(highlight.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' }); highlight.dataset.visible = 'true'; };
    const onInspectPick = (event) => { if (!inspectMode || isPanelTarget(event.target)) return; event.preventDefault(); event.stopPropagation(); selectedStyle = snapshotElement(event.target); renderSpec(); clearInspect(); setStatus('已读取 UI 数值。保存信息后会生成可用于 Figma 标注的文件。'); showToast('已读取 ' + selectedStyle.tagName + ' 的字号、间距和样式。', 'success'); };
    document.addEventListener('pointermove', onInspectMove, true);
    document.addEventListener('click', onInspectPick, true);
    const renderMarks = () => {
      pins.innerHTML = ''; annotations.innerHTML = '';
      marks.forEach((mark, index) => {
        const pin = document.createElement('span'); pin.className = 'pin'; pin.textContent = String(index + 1); pin.style.left = (mark.x * 100) + '%'; pin.style.top = (mark.y * 100) + '%'; pins.appendChild(pin);
        const row = document.createElement('div'); row.className = 'annotation';
        const label = document.createElement('span'); label.textContent = 'A' + (index + 1);
        const input = document.createElement('input'); input.type = 'text'; input.maxLength = 300; input.value = mark.note || ''; input.placeholder = '标注说明'; input.setAttribute('aria-label', '标注 A' + (index + 1) + ' 的说明');
        input.addEventListener('input', () => { marks[index].note = input.value; });
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', '删除标注 A' + (index + 1)); remove.addEventListener('click', () => { marks.splice(index, 1); renderMarks(); });
        row.append(label, input, remove); annotations.appendChild(row);
      });
    };
    trigger.addEventListener('click', () => panel.dataset.open === 'true' ? closePanel() : openPanel());
    close.addEventListener('click', closePanel);
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel.dataset.open === 'true') closePanel(); });
    stage.addEventListener('click', (event) => {
      if (!current) return;
      const rect = image.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      marks.push({ id: 'A' + (marks.length + 1), x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)), note: '' });
      renderMarks();
    });
    draft.addEventListener('click', () => {
      const page = cleanName(name.value) || document.title || '当前页面'; const goal = cleanName(task.value) || '本轮调研任务';
      if (!observation.value.trim()) observation.value = '在 ' + page + ' 页面中，已于当前浏览器视口完成截图留存。页面备注：' + (cleanName(note.value) || '待补充') + '。';
      if (!analysis.value.trim()) analysis.value = '该截图为“' + goal + '”提供了界面证据。请结合后续页面流程与同类竞品对照，确认该能力是否可编辑、可保存并在后续环节生效。';
      if (!verify.value.trim()) verify.value = '继续进入与“' + page + '”关联的下一层页面，验证关键操作是否可完成、结果是否可回溯。';
      advanced.open = true;
      setStatus('已生成可编辑分析草稿，请校对后保存。'); showToast('分析草稿已生成，尚未同步。', 'success');
    });
    inspect.addEventListener('click', () => {
      if (!current) { setStatus('请先完成截图，再读取用于 Figma 标注的 UI 数值。'); return; }
      if (inspectMode) { clearInspect(); return; }
      inspectMode = true; inspect.textContent = '取消读取'; inspectHint.textContent = '现在点选网页元素即可读取。该次点击不会触发网页的跳转、按钮或输入。'; setStatus('正在选择 UI 元素…');
    });
    capture.addEventListener('click', async () => {
      if (!window.__codexResearchCapture) { setStatus('当前浏览器会话未连接截图工具，请重新打开通用截图工具。'); return; }
      capture.disabled = true; setStatus('正在采集并写入素材库…');
      try {
        const result = await window.__codexResearchCapture({ session: session.value, taskId: taskDefaults.taskId, userTask: task.value, name: cleanName(name.value) || document.title || '未命名页面', module: module.value, note: note.value });
        if (result.duplicate) { setStatus(result.message); showToast(result.message, 'warning'); return; }
        current = result.capture; marks = Array.isArray(current.annotations) ? current.annotations : []; selectedStyle = current.styleSnapshot || null; observation.value = current.observation || ''; analysis.value = current.analysis || ''; verify.value = current.toVerify || ''; uxState.value = current.uxEvidence?.state || '常规'; uxTrigger.value = current.uxEvidence?.trigger || ''; uxFeedback.value = current.uxEvidence?.feedback || ''; uxRecovery.value = current.uxEvidence?.recovery || ''; uxAccessibility.value = current.uxEvidence?.accessibility || ''; image.src = result.preview; preview.dataset.visible = 'true'; renderMarks(); renderSpec(); clearInspect();
        setStatus('已入库 ' + current.id + ' · ' + current.filename + '。可继续修改名称或添加标注。'); showToast('截图 ' + current.id + ' 已成功入库。', 'success');
      } catch (error) { const message = '截图失败：' + (error?.message || '未知错误'); setStatus(message); showToast(message, 'error'); }
      finally { capture.disabled = false; }
    });
    save.addEventListener('click', async () => {
      if (!current || !window.__codexResearchUpdate) return;
      save.disabled = true; setStatus('正在保存信息与标注…');
      try {
        const result = await window.__codexResearchUpdate({ session: current.session, captureId: current.id, userTask: task.value, name: cleanName(name.value) || current.name, module: module.value, note: note.value, observation: observation.value, analysis: analysis.value, toVerify: verify.value, uxEvidence: { state: uxState.value, trigger: uxTrigger.value, feedback: uxFeedback.value, recovery: uxRecovery.value, accessibility: uxAccessibility.value }, annotations: marks, styleSnapshot: selectedStyle });
        current = result.capture; marks = current.annotations || []; renderMarks(); setStatus('已更新 ' + current.id + ' · ' + current.filename + '。'); showToast('截图信息已保存。', 'success');
      } catch (error) { const message = '保存失败：' + (error?.message || '未知错误'); setStatus(message); showToast(message, 'error'); }
      finally { save.disabled = false; }
    });
    saveMain.addEventListener('click', () => save.click());
    sync.addEventListener('click', async () => {
      if (!current || !window.__codexResearchSync) return;
      sync.disabled = true; setStatus('正在上传截图并同步到飞书多维表格…');
      try {
        const result = await window.__codexResearchSync({ session: current.session, captureId: current.id });
        current = result.capture; const message = result.updated ? '飞书记录已更新。编号：' + (result.recordId || current.id) + '。' : '已同步到飞书。记录编号：' + (result.recordId || current.id) + '。'; setStatus(message); showToast(message, 'success');
      } catch (error) { const message = '飞书同步失败：' + (error?.message || '未知错误') + '。本地素材仍已保存。'; setStatus(message); showToast(message, 'error'); }
      finally { sync.disabled = false; }
    });
    openLibrary.addEventListener('click', async () => {
      if (!window.__codexResearchOpenLibrary) return;
      await window.__codexResearchOpenLibrary({ session: current?.session || session.value }); setStatus('已打开当前竞品的素材库。');
    });
  })();`;
}

export function buildResearchCapturePanelScript(defaults = {}) {
  return panelScript(defaults);
}

export async function attachResearchCapturePanel(context, { researchDir, defaultSession = '', taskId = '', userTask = '', defaultModule = '' }) {
  const rootDir = path.resolve(researchDir);
  const libraries = new Map();

  async function getLibrary(rawSession) {
    const displayName = shortText(rawSession, 60) || defaultSession || '未命名竞品';
    const session = safeName(displayName);
    if (libraries.has(session)) return libraries.get(session);
    const directory = path.join(rootDir, session);
    const library = {
      session,
      directory,
      imagesDir: path.join(directory, 'images'),
      metadataDir: path.join(directory, 'metadata'),
      indexPath: path.join(directory, 'index.json'),
      markdownPath: path.join(directory, '截图索引.md'),
      index: undefined,
    };
    await fs.mkdir(library.imagesDir, { recursive: true });
    await fs.mkdir(library.metadataDir, { recursive: true });
    library.index = await readJson(library.indexPath, createEmptyIndex(session, displayName));
    if (!Array.isArray(library.index.captures)) library.index.captures = [];
    library.index.displayName = displayName;
    libraries.set(session, library);
    return library;
  }

  async function writeCaptureMetadata(library, capture) {
    const filePath = path.join(library.metadataDir, capture.metadataFilename);
    await writeJson(filePath, capture);
  }

  await context.exposeBinding('__codexResearchCapture', async (source, payload = {}) => {
    const library = await getLibrary(payload.session);
    const page = source.page;
    const name = shortText(payload.name, 100) || await page.title() || '未命名页面';
    const module = shortText(payload.module, 80);
    const note = shortText(payload.note, 300);
    const viewport = page.viewportSize() || { width: 0, height: 0 };
    const viewportLabel = viewport.width && viewport.height ? `${viewport.width}x${viewport.height}` : 'viewport';
    await page.evaluate(() => { const host = document.querySelector('#codex-research-capture-host'); if (host) host.dataset.captureHidden = 'true'; });
    let image;
    try {
      image = await page.screenshot({ scale: 'css' });
    } finally {
      await page.evaluate(() => { const host = document.querySelector('#codex-research-capture-host'); if (host) host.dataset.captureHidden = 'false'; }).catch(() => {});
    }
    const imageHash = createHash('sha256').update(image).digest('hex');
    const finalUrl = page.url();
    const duplicate = library.index.captures.find((item) =>
      item.imageHash === imageHash || (item.finalUrl === finalUrl && item.name === name && item.module === module)
    );
    if (duplicate) {
      const reason = duplicate.imageHash === imageHash ? '页面画面完全相同' : '页面、名称和模块信息相同';
      return { duplicate: true, message: `发现重复素材 ${duplicate.id}（${reason}），未重复入库。可修改页面名称或模块后再截图。` };
    }
    const id = String(library.index.captures.length + 1).padStart(3, '0');
    const filename = `${id}-${safeName(name)}-${viewportLabel}.png`;
    const metadataFilename = `${id}-${safeName(name)}.json`;
    await fs.writeFile(path.join(library.imagesDir, filename), image);
    const capture = {
      id,
      session: library.session,
      taskId: shortText(payload.taskId || taskId, 80),
      name,
      module,
      note,
      userTask: shortText(payload.userTask || userTask, 160),
      observation: shortText(payload.observation || note, 500),
      analysis: '',
      evidenceLevel: 'A',
      toVerify: '',
      syncStatus: '待分析',
      annotations: [],
      capturedAt: new Date().toISOString(),
      finalUrl,
      imageHash,
      title: await page.title(),
      viewport: { width: viewport.width, height: viewport.height, label: viewportLabel },
      screenshot: `images/${filename}`,
      filename,
      metadata: `metadata/${metadataFilename}`,
      metadataFilename,
    };
    library.index.captures.push(capture);
    await writeFigmaSpecFile(library, capture);
    await writeCaptureMetadata(library, capture);
    await writeLibraryFiles(library);
    await writeJson(path.join(rootDir, 'last-capture.json'), capture);
    return { capture, preview: `data:image/png;base64,${image.toString('base64')}` };
  });

  await context.exposeBinding('__codexResearchUpdate', async (_source, payload = {}) => {
    const library = await getLibrary(payload.session);
    const capture = library.index.captures.find((item) => item.id === payload.captureId);
    if (!capture) throw new Error('没有找到要更新的截图。');
    const name = shortText(payload.name, 100) || capture.name;
    const module = shortText(payload.module, 80);
    const note = shortText(payload.note, 300);
    const nextBase = `${capture.id}-${safeName(name)}`;
    const nextFilename = `${nextBase}-${capture.viewport.label}.png`;
    const nextMetadataFilename = `${nextBase}.json`;
    if (nextFilename !== capture.filename) {
      await fs.rename(path.join(library.imagesDir, capture.filename), path.join(library.imagesDir, nextFilename)).catch(() => {});
    }
    if (nextMetadataFilename !== capture.metadataFilename) {
      await fs.rm(path.join(library.metadataDir, capture.metadataFilename), { force: true }).catch(() => {});
    }
    capture.name = name;
    capture.module = module;
    capture.note = note;
    capture.userTask = shortText(payload.userTask || capture.userTask, 160);
    capture.observation = shortText(payload.observation, 500) || capture.observation || note;
    capture.analysis = shortText(payload.analysis, 500) || capture.analysis || '';
    capture.toVerify = shortText(payload.toVerify, 300) || capture.toVerify || '';
    capture.uxEvidence = normalizeUXEvidence(payload.uxEvidence) || capture.uxEvidence || null;
    capture.annotations = normalizeAnnotations(payload.annotations);
    capture.styleSnapshot = normalizeStyleSnapshot(payload.styleSnapshot) || capture.styleSnapshot || null;
    capture.updatedAt = new Date().toISOString();
    capture.filename = nextFilename;
    capture.metadataFilename = nextMetadataFilename;
    capture.screenshot = `images/${nextFilename}`;
    capture.metadata = `metadata/${nextMetadataFilename}`;
    await writeFigmaSpecFile(library, capture);
    await writeCaptureMetadata(library, capture);
    await writeLibraryFiles(library);
    await writeJson(path.join(rootDir, 'last-capture.json'), capture);
    return { capture };
  });

  await context.exposeBinding('__codexResearchOpenLibrary', async (_source, payload = {}) => {
    const library = await getLibrary(payload.session);
    await openPath(library.directory);
    return { directory: library.directory };
  });

  await context.exposeBinding('__codexResearchSync', async (_source, payload = {}) => {
    const library = await getLibrary(payload.session);
    const capture = library.index.captures.find((item) => item.id === payload.captureId);
    if (!capture) throw new Error('没有找到要同步的截图。');
    const synced = await syncCaptureToFeishu({ researchDir: rootDir, library, capture });
    await writeCaptureMetadata(library, synced.capture);
    await writeLibraryFiles(library);
    await writeJson(path.join(rootDir, 'last-capture.json'), synced.capture);
    return { capture: synced.capture, recordId: synced.capture.feishu_sync.record_id, updated: synced.updated };
  });

  // 新标签和后续跳转通过 init script 注入；同时立即补注入已存在的持久化首个标签，
  // 避免某些浏览器启动页或快速跳转导致右下角入口缺失。
  const script = panelScript({ session: defaultSession, taskId, userTask, module: defaultModule });
  await context.addInitScript({ content: script });
  await Promise.all(context.pages().map((page) => page.evaluate(script).catch(() => {})));
}
