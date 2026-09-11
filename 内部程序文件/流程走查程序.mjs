#!/usr/bin/env node

import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const BUNDLED_NODE_MODULES =
  process.env.CODEX_NODE_MODULES ||
  '/Users/afly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const MAX_STEPS = Number(process.env.FLOW_QA_MAX_STEPS || 10);
const KEEP_TASKS = Number(process.env.FLOW_QA_KEEP_TASKS || 3);

function parseArgs(argv) {
  const args = {
    config: '',
    outDir: '截图文件/批量走查',
    profileDir: '浏览器资料',
    browserPath: '',
    waitMs: 1200,
    headless: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') args.config = argv[++i];
    else if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--profile-dir') args.profileDir = argv[++i];
    else if (arg === '--browser-path') args.browserPath = argv[++i];
    else if (arg === '--wait-ms') args.waitMs = Number(argv[++i]);
    else if (arg === '--headless') args.headless = true;
  }

  return args;
}

function timestampLabel() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function safeName(value) {
  const cleaned = String(value || 'flow')
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'flow';
}

function formatBytes(bytes) {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)}${units[index]}`;
}

function parseViewport(value) {
  const viewport = String(value || '1440x810').trim();
  const match = viewport.match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error(`截图尺寸不正确：${viewport}。请使用 1440x810 这种格式。`);
  return { label: viewport.toLowerCase(), width: Number(match[1]), height: Number(match[2]) };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pathSize(targetPath) {
  const stat = await fs.lstat(targetPath).catch(() => null);
  if (!stat) return 0;
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  const entries = await fs.readdir(targetPath, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(entries.map((entry) => pathSize(path.join(targetPath, entry.name))));
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function openPath(targetPath) {
  return new Promise((resolve) => {
    execFile('open', [targetPath], () => resolve());
  });
}

async function loadPlaywright() {
  for (const packageName of ['playwright', 'playwright-core']) {
    try {
      return await import(packageName);
    } catch {
      // Try the next package source.
    }
  }

  try {
    const requireFromBundle = createRequire(path.join(BUNDLED_NODE_MODULES, 'package.json'));
    return requireFromBundle('playwright');
  } catch {
    throw new Error('没有找到 Playwright。请先双击「3-工具管理.command」，选择「安装/修复依赖」，再重新运行。');
  }
}

async function resolveBrowserPath(explicitPath) {
  if (explicitPath) return explicitPath;

  const candidates = [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return '';
}

function resolveStepUrl(baseUrl, stepPath) {
  if (!stepPath) return '';
  if (/^https?:\/\//i.test(stepPath)) return stepPath;
  return new URL(stepPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function askRequired(rl, message, defaultValue = '') {
  while (true) {
    const suffix = defaultValue ? `直接回车默认 ${defaultValue}：` : '';
    const answer = (await rl.question(`${message}${suffix}`)).trim();
    const value = answer || defaultValue;
    if (value) return value;
    console.log('这里不能为空，请重新输入。');
  }
}

async function askOptional(rl, message, defaultValue = '') {
  const suffix = defaultValue ? `直接回车默认 ${defaultValue}：` : '直接回车跳过：';
  const answer = (await rl.question(`${message}${suffix}`)).trim();
  return answer || defaultValue;
}

async function askYesNo(rl, message, defaultYes = false) {
  const suffix = defaultYes ? '直接回车默认 y：' : '直接回车默认 n：';
  const answer = (await rl.question(`${message}${suffix}`)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function askViewport(rl) {
  console.log('');
  console.log('请选择截图尺寸：');
  console.log('  1) 1440x810  Figma 主设计稿验收（推荐）');
  console.log('  2) 1366x768  常见笔记本适配');
  console.log('  3) 1920x1080 宽屏适配');
  console.log('  4) 自定义尺寸');
  const choice = (await rl.question('请输入数字后按回车，直接回车默认 1：')).trim();
  if (!choice || choice === '1') return '1440x810';
  if (choice === '2') return '1366x768';
  if (choice === '3') return '1920x1080';
  if (choice === '4') return askRequired(rl, '请输入自定义尺寸，例如 1280x720：', '1440x810');
  console.log('没有这个选项，默认使用 1440x810。');
  return '1440x810';
}

async function createFlowWizard(rl) {
  console.log('');
  console.log('创建批量流程');
  console.log('');
  console.log('这一步会像通用截图一样直接问你流程信息，然后马上进入截图。');
  console.log('复杂操作默认交给你手动完成，工具只按你指定的路径和步骤截图。');
  console.log('');

  const name = await askRequired(rl, '流程名称，例如 我的作品-衍生创作流程：', '我的作品-衍生创作流程');
  const baseUrl = await askRequired(rl, '测试/线上环境 baseUrl，例如 https://47.99.56.225:58170：');
  const loginPath = await askRequired(rl, '流程起点路径，例如 /works：', '/works');
  const viewport = await askViewport(rl);
  const saveHtml = await askYesNo(rl, '是否默认保存 HTML 临时文件？', false);
  const reviewRules = await askOptional(rl, '设计验收规则 md 路径：', '/Users/afly/Downloads/线上视觉验收.md');

  console.log('');
  console.log('Figma 信息：');
  const fileKey = await askOptional(rl, 'Figma fileKey：', 'SiiA4y0WcjHQgpVPXJ15y0');
  const pageName = await askOptional(rl, 'Figma pageName，例如 我的作品：', '我的作品');
  const scopeNode = await askOptional(rl, '这个流程所在 Page/Section/Frame 的 node-id：');

  console.log('');
  const stepCountRaw = await askRequired(rl, `流程步骤数，建议不超过 ${MAX_STEPS}：`, '1');
  const stepCount = Math.max(1, Number(stepCountRaw) || 1);
  const steps = [];
  let lastPath = loginPath;

  for (let index = 0; index < stepCount; index += 1) {
    const stepNo = index + 1;
    console.log('');
    console.log(`步骤 ${stepNo}/${stepCount}`);
    const stepName = await askRequired(rl, '步骤名称，例如 我的作品列表：', stepNo === 1 ? '我的作品列表' : `步骤${stepNo}`);
    const stepPath = await askOptional(rl, '这一步要访问的路径；如果沿用当前页面可直接回车：', lastPath);
    lastPath = stepPath || lastPath;
    const figmaNode = await askOptional(rl, '这一步对应的 Figma node-id：');
    const needsManual = await askYesNo(rl, '截图前是否需要你手动点击/操作到某个状态？', stepNo > 1);
    const actions = [];
    if (needsManual) {
      const text = await askOptional(
        rl,
        '给自己的手动操作提示：',
        `请在浏览器里完成「${stepName}」所需操作，并调整到设计稿对应状态，然后回到终端按回车。`,
      );
      actions.push({ type: 'manual', text });
    }
    const stepSaveHtml = await askYesNo(rl, '这一步是否单独保存 HTML？', false);

    const step = {
      name: stepName,
      path: stepPath,
      figmaNode,
      capture: true,
    };
    if (actions.length) step.actions = actions;
    if (stepSaveHtml) step.saveHtml = true;
    steps.push(step);
  }

  const config = {
    name,
    baseUrl,
    loginPath,
    viewport,
    saveHtml,
    reviewRules,
    figma: {
      fileKey,
      pageName,
      scopeNode,
    },
    steps,
  };

  console.log('');
  console.log('流程信息已填写完成。');
  console.log('');
  return config;
}

async function runAction(page, action, rl) {
  const type = action.type || 'manual';
  if (type === 'wait') {
    await page.waitForTimeout(Number(action.ms || 1000));
    return;
  }

  if (type === 'manual') {
    const text = action.text || '请在浏览器里手动操作到目标状态，然后回到终端按回车继续。';
    await rl.question(`${text} `);
    return;
  }

  if (type === 'clickText') {
    if (!action.text) throw new Error('clickText 动作缺少 text。');
    await page.getByText(action.text, { exact: action.exact === true }).first().click({ timeout: Number(action.timeout || 10000) });
    return;
  }

  if (type === 'clickSelector') {
    if (!action.selector) throw new Error('clickSelector 动作缺少 selector。');
    await page.locator(action.selector).first().click({ timeout: Number(action.timeout || 10000) });
    return;
  }

  if (type === 'fillSelector') {
    if (!action.selector) throw new Error('fillSelector 动作缺少 selector。');
    await page.locator(action.selector).first().fill(String(action.value || ''), { timeout: Number(action.timeout || 10000) });
    return;
  }

  if (type === 'press') {
    if (!action.key) throw new Error('press 动作缺少 key。');
    await page.keyboard.press(action.key);
    return;
  }

  throw new Error(`不支持的流程动作类型：${type}`);
}

async function pruneOldFlowTasks(flowRoot, currentTaskRoot) {
  const entries = await fs.readdir(flowRoot, { withFileTypes: true }).catch(() => []);
  const dirs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const dirPath = path.join(flowRoot, entry.name);
      const stat = await fs.stat(dirPath).catch(() => null);
      return stat ? { path: dirPath, mtimeMs: stat.mtimeMs } : null;
    }));

  const stale = dirs
    .filter(Boolean)
    .filter((item) => item.path !== currentTaskRoot)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(Math.max(KEEP_TASKS - 1, 0));

  await Promise.all(stale.map((item) => fs.rm(item.path, { recursive: true, force: true }).catch(() => {})));
  if (stale.length) {
    console.log(`自动轻量清理：已删除旧批量走查任务包 ${stale.length} 个，仅保留最近 ${KEEP_TASKS} 个。`);
  }
}

function buildCodexPrompt({ manifestPath, config, taskRoot }) {
  return [
    '# 给 Codex 的走查提示',
    '',
    '请读取这个批量流程走查 manifest：',
    '',
    '```text',
    manifestPath,
    '```',
    '',
    '然后按以下规则输出设计走查报告：',
    '',
    `- 流程名称：${config.name}`,
    `- Figma fileKey：${config.figma?.fileKey || '未填写'}`,
    `- Figma pageName：${config.figma?.pageName || '未填写'}`,
    `- Figma scopeNode：${config.figma?.scopeNode || '未填写'}`,
    `- 验收规则：${config.reviewRules || '请使用当前对话中的线上视觉验收规则和设计规范 skill'}`,
    '',
    '读取策略：',
    '',
    '- 先读 manifest.json。',
    '- 按步骤逐个读取截图，不要一次性展开全部素材。',
    '- 只读取每一步对应的 Figma node。',
    '- HTML 默认不读，只有需要判断结构、字体或间距时再读对应步骤的 HTML。',
    '- 输出每一步问题、严重程度、设计规范依据和修复建议，最后给流程级总结。',
    '',
    '任务包路径：',
    '',
    '```text',
    taskRoot,
    '```',
    '',
  ].join('\n');
}

async function runFlow(args) {
  const rl = readline.createInterface({ input, output });
  let context;

  try {
    console.clear();
    console.log('批量流程走查');
    console.log('');
    console.log('这个入口会先询问流程网址、步骤和 Figma 对应关系，然后按你指定的流程截图。');
    console.log('工具不会自动遍历网站，也不会读取整个 Figma 文件。');
    console.log('');

    const config = args.config ? await readJson(args.config) : await createFlowWizard(rl);
    const configSource = args.config || 'terminal-wizard';
    if (!config) return;

    const steps = Array.isArray(config.steps) ? config.steps : [];
    if (!config.name) throw new Error('流程信息缺少 name。');
    if (!config.baseUrl) throw new Error('流程信息缺少 baseUrl。');
    if (!steps.length) throw new Error('流程至少需要一个步骤。');

    if (steps.length > MAX_STEPS) {
      const ok = await askYesNo(rl, `这个流程有 ${steps.length} 步，超过默认上限 ${MAX_STEPS}。确认继续吗？`, false);
      if (!ok) return;
    }

    const viewport = parseViewport(Array.isArray(config.viewports) ? config.viewports[0] : config.viewport || '1440x810');
    const saveHtmlDefault = config.saveHtml === true;
    const browserPath = await resolveBrowserPath(args.browserPath);
    const taskRoot = path.join(args.outDir, `${safeName(config.name)}-${timestampLabel()}`);
    const screenshotsDir = path.join(taskRoot, 'screenshots');
    const metadataDir = path.join(taskRoot, 'metadata');
    const htmlDir = path.join(taskRoot, 'html临时文件');
    const reportDir = path.join(taskRoot, 'report');
    const logsDir = path.join(taskRoot, 'logs');

    await fs.mkdir(screenshotsDir, { recursive: true });
    await fs.mkdir(metadataDir, { recursive: true });
    await fs.mkdir(reportDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(args.profileDir, { recursive: true });
    await writeJson(path.join(taskRoot, 'config.snapshot.json'), config);

    const { chromium } = await loadPlaywright();
    context = await chromium.launchPersistentContext(args.profileDir, {
      headless: args.headless,
      executablePath: browserPath || undefined,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      ignoreHTTPSErrors: true,
      args: [
        '--new-window',
        '--ignore-certificate-errors',
        '--allow-insecure-localhost',
        `--window-size=${viewport.width},${viewport.height}`,
        '--disk-cache-size=52428800',
        '--media-cache-size=10485760',
      ],
    });

    if (browserPath) console.log(`Using browser: ${browserPath}`);
    const page = context.pages().find((candidate) => !candidate.isClosed()) || await context.newPage();

    const startPath = config.loginPath || steps[0]?.path || '/';
    const startUrl = resolveStepUrl(config.baseUrl, startPath);
    console.log('');
    console.log(`即将打开流程起点：${startUrl}`);
    console.log(`流程名称：${config.name}`);
    console.log(`截图尺寸：${viewport.label}`);
    console.log(`任务包：${taskRoot}`);
    console.log('');
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await rl.question('请先登录或调整到流程起点，准备好后回到终端按回车开始。');

    const capturedSteps = [];

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const stepNo = String(index + 1).padStart(2, '0');
      const stepName = step.name || `步骤${stepNo}`;
      const stepBase = `${stepNo}-${safeName(stepName)}`;
      console.log('');
      console.log(`开始步骤 ${stepNo}/${steps.length}：${stepName}`);

      if (step.path) {
        const stepUrl = resolveStepUrl(config.baseUrl, step.path);
        console.log(`打开：${stepUrl}`);
        await page.goto(stepUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      }

      const actions = Array.isArray(step.actions) ? step.actions : [];
      for (const action of actions) {
        await runAction(page, action, rl);
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(Number(action.afterWaitMs || 300));
      }

      if (step.manualBeforeCapture) {
        await rl.question(`${step.manualBeforeCapture} `);
      }

      await page.waitForTimeout(Number(step.waitMs || args.waitMs));

      if (step.capture === false) {
        capturedSteps.push({
          index: index + 1,
          name: stepName,
          capture: false,
          finalUrl: page.url(),
          figmaNode: step.figmaNode || '',
        });
        continue;
      }

      const screenshotName = `${stepBase}-${viewport.label}.png`;
      const screenshotPath = path.join(screenshotsDir, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: step.fullPage === true, scale: 'css' });
      console.log(`Saved ${screenshotPath}`);

      const stepMeta = {
        index: index + 1,
        name: stepName,
        requestedPath: step.path || '',
        finalUrl: page.url(),
        title: await page.title(),
        capturedAt: new Date().toISOString(),
        viewport,
        figmaNode: step.figmaNode || '',
        designNote: step.designNote || '',
        screenshot: path.relative(taskRoot, screenshotPath),
        saveHtml: step.saveHtml === true || saveHtmlDefault,
      };

      if (stepMeta.saveHtml) {
        await fs.mkdir(htmlDir, { recursive: true });
        const htmlName = `${stepBase}-${viewport.label}.html`;
        const htmlPath = path.join(htmlDir, htmlName);
        await fs.writeFile(htmlPath, await page.content(), 'utf8');
        stepMeta.html = path.relative(taskRoot, htmlPath);
        console.log(`Saved ${htmlPath}`);
      }

      const metaPath = path.join(metadataDir, `${stepBase}.json`);
      await writeJson(metaPath, stepMeta);
      capturedSteps.push({
        ...stepMeta,
        metadata: path.relative(taskRoot, metaPath),
      });
    }

    const manifest = {
      type: 'figma-flow-visual-review',
      version: 1,
      createdAt: new Date().toISOString(),
      taskRoot,
      configSource,
      flow: {
        name: config.name,
        baseUrl: config.baseUrl,
        viewport,
      },
      figma: config.figma || {},
      reviewRules: config.reviewRules || '',
      dataPolicy: {
        maxSteps: MAX_STEPS,
        keepTasks: KEEP_TASKS,
        htmlDefault: saveHtmlDefault,
        readingStrategy: 'Codex should read manifest first, then inspect screenshots and Figma nodes step by step.',
      },
      steps: capturedSteps,
    };

    const manifestPath = path.join(taskRoot, 'manifest.json');
    await writeJson(manifestPath, manifest);
    await fs.writeFile(
      path.join(reportDir, '给Codex读取.md'),
      buildCodexPrompt({ manifestPath, config, taskRoot }),
      'utf8',
    );

    await pruneOldFlowTasks(args.outDir, taskRoot);
    const taskSize = await pathSize(taskRoot);
    console.log('');
    console.log('流程截图完成。');
    console.log(`任务包大小：${formatBytes(taskSize)}`);
    console.log(`Manifest：${manifestPath}`);
    console.log(`给 Codex 的提示：${path.join(reportDir, '给Codex读取.md')}`);
    console.log('');
    await openPath(taskRoot);

    while (true) {
      console.log('');
      console.log('下一步：');
      console.log('  1) 打开任务包文件夹');
      console.log('  2) 删除当前任务包里的 HTML 临时文件');
      console.log('  3) 删除当前任务包');
      console.log('  4) 结束');
      const next = (await rl.question('请输入数字后按回车，直接回车默认 4：')).trim() || '4';
      if (next === '1') {
        await openPath(taskRoot);
      } else if (next === '2') {
        await fs.rm(htmlDir, { recursive: true, force: true });
        console.log('已删除当前任务包里的 HTML 临时文件。');
      } else if (next === '3') {
        const ok = await askYesNo(rl, '确认删除当前任务包吗？', false);
        if (ok) {
          await fs.rm(taskRoot, { recursive: true, force: true });
          console.log('已删除当前任务包。');
          break;
        }
      } else {
        break;
      }
    }
  } finally {
    if (context) await context.close().catch(() => {});
    rl.close();
  }

  console.log('');
  console.log('批量流程走查已结束。');
}

const args = parseArgs(process.argv.slice(2));
await runFlow(args);
