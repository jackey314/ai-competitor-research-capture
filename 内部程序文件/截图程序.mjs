#!/usr/bin/env node

import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { attachResearchCapturePanel } from './竞调采集面板.mjs';

const BUNDLED_NODE_MODULES =
  process.env.CODEX_NODE_MODULES ||
  '/Users/afly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const MAX_CAPTURE_FILES = Number(process.env.FIGMA_QA_MAX_CAPTURES || 12);
const MAX_HTML_FILES = Number(process.env.FIGMA_QA_MAX_HTML || 6);

function parseArgs(argv) {
  const args = {
    url: '',
    name: 'page',
    viewports: '1440x810',
    outDir: '截图文件',
    profileDir: '',
    browserPath: '',
    manual: false,
    fullPage: false,
    headless: false,
    waitMs: 1200,
    saveHtml: false,
    timestamp: false,
    wizard: false,
    cleanupBrowserCache: false,
    researchPanel: false,
    researchDir: '',
    researchSession: '',
    researchTaskId: '',
    researchUserTask: '',
    researchModule: '',
    launchOnly: false,
  };

  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manual') args.manual = true;
    else if (arg === '--full-page') args.fullPage = true;
    else if (arg === '--headless') args.headless = true;
    else if (arg === '--wizard') args.wizard = true;
    else if (arg === '--cleanup-browser-cache') args.cleanupBrowserCache = true;
    else if (arg === '--research-panel') args.researchPanel = true;
    else if (arg === '--research-dir') args.researchDir = argv[++i];
    else if (arg === '--research-session') args.researchSession = argv[++i];
    else if (arg === '--research-task-id') args.researchTaskId = argv[++i];
    else if (arg === '--research-user-task') args.researchUserTask = argv[++i];
    else if (arg === '--research-module') args.researchModule = argv[++i];
    else if (arg === '--launch-only') args.launchOnly = true;
    else if (arg === '--viewport' || arg === '--viewports') args.viewports = argv[++i];
    else if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--profile-dir') args.profileDir = argv[++i];
    else if (arg === '--browser-path') args.browserPath = argv[++i];
    else if (arg === '--wait-ms') args.waitMs = Number(argv[++i]);
    else if (arg === '--name') args.name = argv[++i];
    else if (arg === '--save-html') args.saveHtml = true;
    else if (arg === '--timestamp') args.timestamp = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else positionals.push(arg);
  }

  if (positionals[0]) args.url = positionals[0];
  if (positionals[1]) args.name = positionals[1];
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node 截图程序.mjs --wizard
  node 截图程序.mjs <url> [name] [options]

Examples:
  node 截图程序.mjs https://47.99.56.225:58170/works works
  node 截图程序.mjs https://47.99.56.225:58170/ranking ranking --manual
  node 截图程序.mjs https://47.99.56.225:58170/works works --viewports 1440x810,1366x768,1920x1080

Options:
  --wizard                Start the interactive screenshot workflow.
  --manual                Open the browser and wait for Enter before screenshot.
  --viewport <WxH>        Capture one viewport. Default: 1440x810.
  --viewports <list>      Capture several comma-separated viewports.
  --full-page             Capture the full scrollable page instead of viewport only.
  --headless              Run without showing the browser window.
  --out-dir <dir>         Screenshot output directory. Default: 截图文件.
  --profile-dir <dir>     Optional persistent browser profile directory. Default: temporary profile.
  --browser-path <path>   Use a local Chrome/Edge executable.
  --wait-ms <ms>          Extra wait after load before screenshot. Default: 1200.
  --save-html             Save rendered HTML into 截图文件/html临时文件.
  --timestamp             Add a timestamp to output filenames.
  --cleanup-browser-cache Clean browser cache under --profile-dir while keeping login data where possible.
  --research-panel        Add an in-page capture, preview and annotation panel.
  --research-dir <dir>    Root directory for the competitor research screenshot library.
  --research-session <n>  Default competitor/research name shown in the panel.
  --research-task-id <n>  Optional task identifier saved to each capture.
  --research-user-task <n> Default user task shown in the capture panel.
  --research-module <n>  Default module shown in the capture panel.
  --launch-only          Open the capture browser and keep it open; do not create a terminal screenshot.
`);
}

function parseViewports(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(\d+)x(\d+)$/i);
      if (!match) throw new Error(`Invalid viewport "${item}". Use WIDTHxHEIGHT, for example 1440x810.`);
      return { label: item.toLowerCase(), width: Number(match[1]), height: Number(match[2]) };
    });
}

function safeName(value) {
  const cleaned = String(value || 'page')
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'page';
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
    throw new Error(
      [
        '没有找到 Playwright 运行依赖。',
        '如果这是别人收到的发送包，请先双击「3-工具管理.command」，选择「安装/修复依赖」。',
        '如果仍然失败，请确认电脑已安装 Node.js，并且当前目录可以访问网络安装依赖。',
      ].join('\n'),
    );
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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

async function waitForEnter(message) {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

function ensurePageOpen(page) {
  if (page.isClosed()) {
    throw new Error('浏览器窗口已经关闭，无法截图。请重新运行工具，打开页面后不要关闭浏览器，回到终端按回车截图。');
  }
}

async function setResearchPanelHidden(page, hidden) {
  await page.evaluate((nextHidden) => {
    const host = document.querySelector('#codex-research-capture-host');
    if (host) host.dataset.captureHidden = nextHidden ? 'true' : 'false';
  }, hidden).catch(() => {});
}

const args = parseArgs(process.argv.slice(2));

function openPath(targetPath) {
  return new Promise((resolve) => {
    execFile('open', [targetPath], () => resolve());
  });
}

function activateBrowser(browserPath) {
  const appName = browserPath.includes('Microsoft Edge') ? 'Microsoft Edge' : 'Google Chrome';
  return new Promise((resolve) => execFile('open', ['-a', appName], () => resolve()));
}

async function askRequired(rl, message) {
  while (true) {
    const answer = (await rl.question(message)).trim();
    if (answer) return answer;
    console.log('这里不能为空，请重新输入。');
  }
}

async function askUrl(rl, lastUrl) {
  if (lastUrl) {
    const answer = (await rl.question(`请输入完整页面网址，直接回车使用上次网址 ${lastUrl}：`)).trim();
    return answer || lastUrl;
  }
  return askRequired(rl, '请输入完整页面网址：');
}

async function askPageName(rl, lastName) {
  const defaultText = lastName ? `，直接回车默认 ${lastName}` : '';
  const answer = (await rl.question(`请输入页面名称/文件名前缀，例如 works、ranking、profile-edit${defaultText}：`)).trim();
  return answer || lastName || 'page';
}

async function askViewports(rl, lastViewports) {
  console.log('');
  console.log('请选择截图尺寸：');
  console.log('  1) 1440x810  Figma 主设计稿验收（推荐）');
  console.log('  2) 1366x768  常见笔记本适配');
  console.log('  3) 1920x1080 宽屏适配');
  console.log('  4) 三种尺寸都截：1440x810,1366x768,1920x1080');
  console.log('  5) 自定义尺寸');
  console.log('');
  const defaultText = lastViewports ? `上次尺寸 ${lastViewports}` : '1';
  const choice = (await rl.question(`请输入数字后按回车，直接回车默认 ${defaultText}：`)).trim();

  if (!choice) return parseViewports(lastViewports || '1440x810');
  if (choice === '1') return parseViewports('1440x810');
  if (choice === '2') return parseViewports('1366x768');
  if (choice === '3') return parseViewports('1920x1080');
  if (choice === '4') return parseViewports('1440x810,1366x768,1920x1080');
  if (choice === '5') {
    const custom = (await rl.question('请输入自定义尺寸，例如 1280x720，直接回车默认 1440x810：')).trim();
    return parseViewports(custom || '1440x810');
  }

  console.log('没有这个选项，默认使用 1440x810。');
  return parseViewports('1440x810');
}

async function askSaveHtml(rl) {
  console.log('');
  console.log('是否额外保存 HTML 临时文件？');
  console.log('  1) 不保存，只截图走查（推荐，文件最小）');
  console.log('  2) 保存，需要 Codex 还原/复用界面时使用');
  console.log('');
  const choice = (await rl.question('请输入数字后按回车，直接回车默认 1：')).trim();
  return choice === '2';
}

async function askNextAction(rl) {
  console.log('');
  console.log('下一步你想做什么？');
  console.log('  1) 继续当前任务：不用重新填网址/页面名/尺寸，直接在浏览器切换界面后截图');
  console.log('  2) 创建新任务：重新输入网址、页面名和截图尺寸');
  console.log('  3) 结束任务：关闭浏览器并退出工具');
  console.log('');
  console.log('清理、打包和缓存管理请双击「3-工具管理.command」。');
  console.log('');
  const answer = (await rl.question('请输入数字后按回车，直接回车默认 1：')).trim();
  if (!answer || answer === '1') return 'continue';
  if (answer === '2') return 'new';
  if (answer === '3') return 'end';
  console.log('没有这个选项，默认继续当前任务。');
  return 'continue';
}

async function cleanupHtml(outDir) {
  const htmlDir = path.join(outDir, 'html临时文件');
  await fs.rm(htmlDir, { recursive: true, force: true });
  console.log('');
  console.log(`已删除 HTML 临时文件：${htmlDir}`);
}

async function cleanupCaptureArtifacts(outDir) {
  await cleanupHtml(outDir);
  let removedCount = 0;
  const entries = await fs.readdir(outDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    if (entry.name === '_tool-state.json') return;
    if (
      entry.name.endsWith('.png') ||
      entry.name.endsWith('.json') ||
      entry.name === '_last-run.log'
    ) {
      await fs.rm(path.join(outDir, entry.name), { force: true });
      removedCount += 1;
    }
  }));
  console.log('');
  console.log(`已清理截图素材 ${removedCount} 个文件。`);
  console.log('已保留工具文件和浏览器资料；下次打开仍可尽量保留登录状态。');
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

async function cleanupBrowserCache(profileDir) {
  const exists = await fileExists(profileDir);
  console.log('');
  console.log('清理浏览器缓存');
  console.log('');

  if (!exists) {
    console.log('没有找到浏览器资料文件夹：');
    console.log(profileDir);
    return;
  }

  console.log('将清理缓存、GPU 缓存、代码缓存、浏览器指标和可重新生成的模型/安全列表。');
  console.log('会尽量保留 Cookie、登录态、Local Storage、IndexedDB、历史记录和地址栏记录。');
  console.log('');

  const beforeSize = await pathSize(profileDir);
  const targets = [
    'BrowserMetrics',
    'BrowserMetrics-spare.pma',
    'component_crx_cache',
    'extensions_crx_cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'GraphiteDawnCache',
    'GrShaderCache',
    'ShaderCache',
    'ProvenanceData',
    'ProvenanceDataAllowList',
    'ProvenanceDataTensors',
    'SmartScreen/local',
    'SmartScreen/RemoteData',
    'Default/Cache',
    'Default/Code Cache',
    'Default/GPUCache',
    'Default/DawnGraphiteCache',
    'Default/DawnWebGPUCache',
    'Default/GraphiteDawnCache',
    'Default/GrShaderCache',
    'Default/ShaderCache',
    'Default/Media Cache',
    'Default/Shared Dictionary/cache',
    'Default/Service Worker/CacheStorage',
    'Default/Service Worker/ScriptCache',
    'Default/BrowserMetrics',
    'Default/AutofillAiModelCache',
  ];

  let removedCount = 0;
  let removedBytes = 0;
  for (const relativePath of targets) {
    const targetPath = path.join(profileDir, relativePath);
    if (!(await fileExists(targetPath))) continue;
    removedBytes += await pathSize(targetPath);
    await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
    removedCount += 1;
  }

  const afterSize = await pathSize(profileDir);
  console.log(`已清理缓存项目：${removedCount} 个。`);
  console.log(`清理前：${formatBytes(beforeSize)}`);
  console.log(`已释放约：${formatBytes(Math.max(removedBytes, beforeSize - afterSize))}`);
  console.log(`清理后：${formatBytes(afterSize)}`);
  console.log('');
  console.log('如果下次打开网站要求重新登录，说明该网站把登录状态放在了被浏览器判定为可清理的缓存区域；重新登录一次即可。');
}

async function loadToolState(outDir) {
  try {
    const raw = await fs.readFile(path.join(outDir, '_tool-state.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveToolState(outDir, state) {
  await fs.writeFile(path.join(outDir, '_tool-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function pruneOldFiles(files, keepCount) {
  const sorted = files
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const stale = sorted.slice(keepCount);
  await Promise.all(stale.map((file) => fs.rm(file.path, { force: true }).catch(() => {})));
  return stale.length;
}

async function pruneCaptureStore(outDir) {
  const entries = await fs.readdir(outDir, { withFileTypes: true }).catch(() => []);
  const pngFiles = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map(async (entry) => {
      const filePath = path.join(outDir, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      return stat ? { path: filePath, name: entry.name, mtimeMs: stat.mtimeMs } : null;
    }));

  const stalePngs = pngFiles
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(MAX_CAPTURE_FILES);

  await Promise.all(stalePngs.map(async (file) => {
    await fs.rm(file.path, { force: true }).catch(() => {});
    const jsonName = file.name.replace(/\.png$/i, '.json');
    await fs.rm(path.join(outDir, jsonName), { force: true }).catch(() => {});
  }));

  const htmlDir = path.join(outDir, 'html临时文件');
  const htmlEntries = await fs.readdir(htmlDir, { withFileTypes: true }).catch(() => []);
  const htmlFiles = await Promise.all(htmlEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map(async (entry) => {
      const filePath = path.join(htmlDir, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      return stat ? { path: filePath, name: entry.name, mtimeMs: stat.mtimeMs } : null;
    }));
  const removedHtmlCount = await pruneOldFiles(htmlFiles, MAX_HTML_FILES);

  const removedCaptureCount = stalePngs.length;
  if (removedCaptureCount || removedHtmlCount) {
    console.log('');
    console.log(`自动轻量清理：已保留最近 ${MAX_CAPTURE_FILES} 张截图、最近 ${MAX_HTML_FILES} 个 HTML。`);
    if (removedCaptureCount) console.log(`已删除旧截图及对应 JSON：${removedCaptureCount} 组。`);
    if (removedHtmlCount) console.log(`已删除旧 HTML：${removedHtmlCount} 个。`);
  }
}

async function createContext({ viewports, profileDir, browserPath, headless, researchPanel, researchDir, researchSession, researchTaskId, researchUserTask, researchModule }) {
  const { chromium } = await loadPlaywright();
  const firstViewport = viewports[0];
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    executablePath: browserPath || undefined,
    viewport: { width: firstViewport.width, height: firstViewport.height },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    args: [
      '--new-window',
      '--ignore-certificate-errors',
      '--allow-insecure-localhost',
      `--window-size=${firstViewport.width},${firstViewport.height}`,
      '--disk-cache-size=52428800',
      '--media-cache-size=10485760',
    ],
  });

  if (researchPanel && !headless) {
    await attachResearchCapturePanel(context, {
      researchDir: researchDir || path.join(process.cwd(), '截图文件', '竞调素材库'),
      defaultSession: researchSession,
      taskId: researchTaskId,
      userTask: researchUserTask,
      defaultModule: researchModule,
    });
  }

  return context;
}

async function captureViewports({
  page,
  task,
  viewports,
  args: captureArgs,
  saveHtml,
  navigate,
  browserPath,
  promptForManual,
}) {
  const saved = [];
  const captureStamp = timestampLabel();
  const baseName = safeName(task.name);

  for (const viewport of viewports) {
    ensurePageOpen(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    if (navigate) {
      await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(captureArgs.waitMs);

    if (captureArgs.manual) {
      const urlLabel = navigate ? task.url : page.url();
      await promptForManual(
        `浏览器已打开：${urlLabel}（${viewport.label}）。请登录或调整到目标状态，不要关闭浏览器，然后回到这个终端窗口按回车截图... `,
      );
      ensurePageOpen(page);
      await page.waitForTimeout(200);
    }

    ensurePageOpen(page);
    const suffix = `${viewport.label}${captureArgs.fullPage ? '-full' : ''}${captureArgs.timestamp ? `-${captureStamp}` : ''}`;
    const filename = `${baseName}-${suffix}.png`;
    const target = path.join(captureArgs.outDir, filename);
    if (captureArgs.researchPanel) await setResearchPanelHidden(page, true);
    try {
      await page.screenshot({ path: target, fullPage: captureArgs.fullPage, scale: 'css' });
    } finally {
      if (captureArgs.researchPanel) await setResearchPanelHidden(page, false);
    }
    console.log(`Saved ${target}`);

    const finalUrl = page.url();
    const title = await page.title();
    const metadata = {
      capturedAt: new Date().toISOString(),
      requestedUrl: task.url,
      finalUrl,
      title,
      name: baseName,
      viewport: { width: viewport.width, height: viewport.height, label: viewport.label },
      deviceScaleFactor: 2,
      screenshotScale: 'css',
      fullPage: captureArgs.fullPage,
      manual: captureArgs.manual,
      browserPath: browserPath || 'playwright-bundled-chromium',
      screenshot: filename,
    };

    if (saveHtml) {
      const htmlDir = path.join(captureArgs.outDir, 'html临时文件');
      await fs.mkdir(htmlDir, { recursive: true });
      const htmlName = `${baseName}-${suffix}.html`;
      await fs.writeFile(path.join(htmlDir, htmlName), await page.content(), 'utf8');
      metadata.html = `html临时文件/${htmlName}`;
      console.log(`Saved ${path.join(htmlDir, htmlName)}`);
    }

    const jsonName = `${baseName}-${suffix}.json`;
    await fs.writeFile(path.join(captureArgs.outDir, jsonName), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(captureArgs.outDir, '_latest.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    console.log(`Saved ${path.join(captureArgs.outDir, jsonName)}`);
    saved.push({ png: target, json: path.join(captureArgs.outDir, jsonName), metadata });
  }

  return saved;
}

async function reportCaptureResult(outDir, saved, saveHtml, taskName) {
  console.log('');
  console.log('完成。截图和元数据在：');
  console.log(outDir);

  const latest = saved.at(-1);
  if (latest?.png) {
    console.log('');
    console.log('最新截图：');
    console.log(latest.png);
    console.log('');
    console.log('正在打开最新截图预览...');
    await openPath(latest.png);
    await openPath(outDir);
  }

  if (saveHtml) {
    console.log('');
    console.log('HTML 临时文件已保存在：');
    console.log(path.join(outDir, 'html临时文件'));
    console.log('');
    console.log('如果你还需要 Codex 读取/还原，请先不要删除。');
    console.log('等 Codex 使用完后，可以在下一步菜单选择「清理 HTML 临时文件」。');
  }

  console.log('');
  console.log(`你可以回到 Codex 告诉我：截图好了，页面名是 ${taskName}。`);
}

async function runOneShot(captureArgs) {
  const viewports = parseViewports(captureArgs.viewports);
  const browserPath = await resolveBrowserPath(captureArgs.browserPath);
  const shouldCleanupProfile = !captureArgs.profileDir;
  const profileDir = captureArgs.profileDir || await fs.mkdtemp(path.join(os.tmpdir(), 'figma-qa-screenshot-profile-'));

  await fs.mkdir(captureArgs.outDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const context = await createContext({
    viewports,
    profileDir,
    browserPath,
    headless: captureArgs.headless,
    researchPanel: captureArgs.researchPanel,
    researchDir: captureArgs.researchDir,
    researchSession: captureArgs.researchSession,
    researchTaskId: captureArgs.researchTaskId,
    researchUserTask: captureArgs.researchUserTask,
    researchModule: captureArgs.researchModule,
  });

  if (browserPath) console.log(`Using browser: ${browserPath}`);

  try {
    const page = context.pages()[0] || await context.newPage();
    if (captureArgs.launchOnly) {
      // 保留一个空白标签作为浏览器会话锚点。部分竞品页会关闭或替换首个标签，
      // 若它是唯一标签，Chromium 会一并退出整个窗口。
      const keeperPage = await context.newPage();
      await keeperPage.goto('about:blank');
      await page.goto(captureArgs.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(captureArgs.waitMs);
      await page.bringToFront();
      await activateBrowser(browserPath);
      console.log('采集浏览器已打开。请在网页右下角使用「截图入库」；完成后关闭此浏览器窗口即可。');
      // 竞品网站会重定向、替换或主动关闭当前标签；这不代表用户结束采集。
      // 仅在整个浏览器上下文关闭时才回收进程，避免网页一闪即退出。
      // 明确禁用 Playwright 默认等待超时；采集会话应持续到用户关闭浏览器。
      await context.waitForEvent('close', { timeout: 0 }).catch(() => {});
      return;
    }
    await captureViewports({
      page,
      task: { url: captureArgs.url, name: captureArgs.name },
      viewports,
      args: captureArgs,
      saveHtml: captureArgs.saveHtml,
      navigate: true,
      browserPath,
      promptForManual: waitForEnter,
    });
  } finally {
    await context.close();
    if (shouldCleanupProfile) {
      await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function runWizard(captureArgs) {
  const rl = readline.createInterface({ input, output });
  const browserPath = await resolveBrowserPath(captureArgs.browserPath);
  const shouldCleanupProfile = !captureArgs.profileDir;
  const profileDir = captureArgs.profileDir || await fs.mkdtemp(path.join(os.tmpdir(), 'figma-qa-screenshot-profile-'));
  let toolState = await loadToolState(captureArgs.outDir);
  let context;
  let page;
  let currentTask;
  let currentViewports;
  let nextAction = 'new';

  await fs.mkdir(captureArgs.outDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  async function closeCurrentContext() {
    if (context) {
      await context.close().catch(() => {});
    }
    context = undefined;
    page = undefined;
  }

  async function ensureWizardPage() {
    try {
      if (context) {
        if (page && !page.isClosed()) return { page, reopened: false };
        const existing = context.pages().find((candidate) => !candidate.isClosed());
        if (existing) {
          page = existing;
          return { page, reopened: false };
        }
        page = await context.newPage();
        return { page, reopened: true };
      }
    } catch {
      await closeCurrentContext();
    }

    context = await createContext({
      viewports: currentViewports,
      profileDir,
      browserPath,
      headless: captureArgs.headless,
      researchPanel: captureArgs.researchPanel,
      researchDir: captureArgs.researchDir,
      researchSession: captureArgs.researchSession,
      researchTaskId: captureArgs.researchTaskId,
      researchUserTask: captureArgs.researchUserTask,
      researchModule: captureArgs.researchModule,
    });
    if (browserPath) console.log(`Using browser: ${browserPath}`);
    page = context.pages().find((candidate) => !candidate.isClosed()) || await context.newPage();
    return { page, reopened: true };
  }

  try {
    console.clear();
    console.log('通用截图工具');
    console.log('');
    console.log('用途：以后任何需要 Codex 走查、评审、复用或还原的页面，都可以用它采集素材。');
    console.log('');
    console.log('基础流程：');
    console.log('  1. 输入完整页面网址');
    console.log('  2. 输入一个页面名');
    console.log('  3. 用数字选择截图尺寸');
    console.log('  4. 浏览器打开后调整到目标状态，再回到终端按回车截图');
    console.log('');
    console.log(`浏览器资料会保存在：${profileDir}`);
    console.log('这样下次打开工具时，会尽量保留登录状态、历史记录和地址栏记录。');
    console.log('');
    console.log('截图完成后可以继续当前任务、创建新任务或结束任务。');
    console.log('清理、打包和缓存管理统一放在「3-工具管理.command」。');
    console.log('');

    while (nextAction !== 'end') {
      let saveHtml = false;
      let navigate = false;

      if (nextAction === 'new' || !currentTask) {
        const url = await askUrl(rl, toolState.lastUrl);
        console.log('');
        const name = await askPageName(rl, toolState.lastName);
        currentViewports = await askViewports(rl, toolState.lastViewports);
        saveHtml = await askSaveHtml(rl);
        currentTask = { url, name };
        navigate = true;

        console.log('');
        console.log(`即将打开：${currentTask.url}`);
        console.log(`页面名称：${currentTask.name}`);
        console.log(`截图尺寸：${currentViewports.map((viewport) => viewport.label).join(',')}`);
        console.log(`保存位置：${captureArgs.outDir}`);
        console.log(`HTML 临时文件：${saveHtml ? '保存到 截图文件/html临时文件' : '不保存'}`);
        console.log('');
        console.log('浏览器打开后：');
        console.log('  1. 如果需要登录，请先登录。');
        console.log('  2. 如果要截的是某个弹窗/状态，请手动操作到那个状态。');
        console.log('  3. 不要关闭浏览器窗口。');
        console.log('  4. 回到这个终端窗口，按回车截图。');
        console.log('');
        await rl.question('现在按回车开始打开浏览器。');
        console.log('');

        const browser = await ensureWizardPage();
        page = browser.page;
      } else {
        saveHtml = await askSaveHtml(rl);
        console.log('');
        console.log('继续当前任务。');
        console.log('请直接在已打开的浏览器里切换到要截的页面、弹窗或状态。');
        console.log('不用重新输入网址、页面名或尺寸；准备好后回到这个终端按回车截图。');
        console.log('');
        const browser = await ensureWizardPage();
        page = browser.page;
        if (browser.reopened) {
          console.log('刚刚检测到浏览器窗口已关闭，已重新打开专用浏览器窗口。');
          console.log('会先回到当前任务的网址，你也可以在浏览器里继续切换到目标状态。');
        }
        navigate = browser.reopened;
      }

      let saved = [];
      try {
        saved = await captureViewports({
          page,
          task: currentTask,
          viewports: currentViewports,
          args: captureArgs,
          saveHtml,
          navigate,
          browserPath,
          promptForManual: (message) => rl.question(message),
        });
      } catch (error) {
        console.log('');
        console.log(`这次没有截到图：${error.message}`);
        console.log('如果是误关了浏览器，可以直接选择继续当前任务，工具会重新打开专用浏览器窗口。');
        await closeCurrentContext();
        nextAction = await askNextAction(rl);
        continue;
      }

      const latestMetadata = saved.at(-1)?.metadata;
      toolState = {
        lastUrl: latestMetadata?.finalUrl || currentTask.url,
        lastName: currentTask.name,
        lastViewports: currentViewports.map((viewport) => viewport.label).join(','),
        updatedAt: new Date().toISOString(),
      };
      await saveToolState(captureArgs.outDir, toolState);

      if (latestMetadata?.finalUrl) {
        currentTask.url = latestMetadata.finalUrl;
      }

      await pruneCaptureStore(captureArgs.outDir);
      await reportCaptureResult(captureArgs.outDir, saved, saveHtml, currentTask.name);
      nextAction = await askNextAction(rl);
    }
  } finally {
    rl.close();
    if (context) await context.close();
    if (shouldCleanupProfile) {
      await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  console.log('');
  console.log('任务已结束，浏览器已关闭。');
}

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.cleanupBrowserCache) {
  const profileDir = args.profileDir || path.join(process.cwd(), '浏览器资料');
  await cleanupBrowserCache(profileDir);
} else if (args.wizard) {
  await runWizard({
    ...args,
    manual: true,
    timestamp: true,
  });
} else if (!args.url) {
  printHelp();
  process.exit(1);
} else {
  await runOneShot(args);
}
