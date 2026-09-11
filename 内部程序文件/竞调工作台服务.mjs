#!/usr/bin/env node

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(toolDir, '内部程序文件', '竞调工作台');
const taskDir = path.join(toolDir, '截图文件', '竞调任务');
const researchDir = path.join(toolDir, '截图文件', '竞调素材库');
const normalCaptureDir = path.join(toolDir, '截图文件', '普通截图');
const profileDir = path.join(toolDir, '浏览器资料');
const port = 48923;
const nodeBin = process.execPath;
let activeTask = null;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function safeName(value, fallback = '竞调任务') {
  const cleaned = String(value || fallback).trim().replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function nowCompact() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return fallback; }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function listTasks() {
  const entries = await fs.readdir(taskDir, { withFileTypes: true }).catch(() => []);
  const tasks = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => readJson(path.join(taskDir, entry.name))));
  return tasks.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 12);
}

async function getStatus() {
  let latestCapture = await readJson(path.join(researchDir, 'last-capture.json'));
  if (latestCapture?.session && latestCapture?.metadata && !latestCapture.feishu_sync) {
    latestCapture = await readJson(path.join(researchDir, latestCapture.session, latestCapture.metadata), latestCapture);
  }
  return {
    activeTask: activeTask ? { ...activeTask, running: !activeTask.finishedAt } : null,
    latestCapture: latestCapture ? {
      id: latestCapture.id, session: latestCapture.session, name: latestCapture.name,
      module: latestCapture.module, capturedAt: latestCapture.capturedAt,
      syncStatus: latestCapture.feishu_sync?.status === 'synced' ? '已同步飞书' : '待同步',
    } : null,
  };
}

async function getCurrentLibrary(requestedSession = '') {
  const lastCapture = await readJson(path.join(researchDir, 'last-capture.json'));
  const session = requestedSession ? safeName(requestedSession) : lastCapture?.session;
  if (!session) return null;
  const directory = path.join(researchDir, session);
  const indexPath = path.join(directory, 'index.json');
  const index = await readJson(indexPath, { captures: [] });
  return { directory, indexPath, index, session };
}

async function listCaptures(session = '') {
  const library = await getCurrentLibrary(session);
  if (!library) return [];
  return (library.index.captures || []).slice().reverse().map((capture) => ({
    id: capture.id, name: capture.name, module: capture.module || '',
    syncStatus: capture.feishu_sync?.status === 'synced' ? '已同步' : '待同步',
    imageUrl: `/api/capture-image?id=${encodeURIComponent(capture.id)}&session=${encodeURIComponent(library.session)}`,
  }));
}

async function findCapture(id, session = '') {
  const library = await getCurrentLibrary(session);
  if (!library) return null;
  const capture = (library.index.captures || []).find((item) => item.id === id);
  return capture ? { library, capture } : null;
}

async function deleteCapture(id, session = '') {
  const found = await findCapture(id, session);
  if (!found) throw new Error('没有找到该截图。');
  const { library, capture } = found;
  await fs.rm(path.join(library.directory, capture.screenshot), { force: true });
  await fs.rm(path.join(library.directory, capture.metadata), { force: true });
  library.index.captures = library.index.captures.filter((item) => item.id !== id);
  library.index.updatedAt = new Date().toISOString();
  await fs.writeFile(library.indexPath, `${JSON.stringify(library.index, null, 2)}\n`, 'utf8');
  const remaining = library.index.captures.at(-1);
  if (remaining) await fs.writeFile(path.join(researchDir, 'last-capture.json'), `${JSON.stringify(remaining, null, 2)}\n`, 'utf8');
  else await fs.rm(path.join(researchDir, 'last-capture.json'), { force: true });
  return { id };
}

function openUrl(url) {
  execFile('open', [url], () => {});
}

async function startTask(payload) {
  const competitor = String(payload.competitor || '').trim();
  const requestedUrl = String(payload.url || '').trim();
  const url = requestedUrl || 'about:blank';
  const userTask = String(payload.userTask || '').trim() || '自由走查并沉淀关键截图';
  const module = String(payload.module || '').trim();
  if (!competitor) throw new Error('请填写竞品名称。');
  if (url !== 'about:blank') {
    try { new URL(url); } catch { throw new Error('请输入完整网址，例如 https://example.com/page'); }
  }
  if (activeTask && !activeTask.finishedAt) throw new Error('已有采集窗口正在运行，请先完成或关闭该窗口。');
  const taskId = `${safeName(competitor).toUpperCase().slice(0, 12)}-${nowCompact()}`;
  const task = { taskId, competitor, startUrl: url, userTask, module, viewport: '1440x810', status: '进行中', createdAt: new Date().toISOString() };
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, `${taskId}.json`), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  const script = path.join(toolDir, '内部程序文件', '截图程序.mjs');
  const child = spawn(nodeBin, [script, url, '竞调任务起始页', '--launch-only', '--viewport', '1440x810',
    '--out-dir', normalCaptureDir, '--profile-dir', profileDir, '--research-panel', '--research-dir', researchDir,
    '--research-session', competitor, '--research-task-id', taskId, '--research-user-task', userTask, '--research-module', module],
  { cwd: toolDir, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
  activeTask = { ...task, startedAt: new Date().toISOString(), pid: child.pid };
  const errorChunks = [];
  child.stderr.on('data', (chunk) => errorChunks.push(chunk));
  child.once('error', () => {
    if (activeTask?.taskId === taskId) {
      activeTask.status = '打开失败'; activeTask.launchError = '采集浏览器未能启动，请重新尝试。'; activeTask.finishedAt = new Date().toISOString();
    }
  });
  child.once('exit', (code) => {
    if (activeTask?.taskId !== taskId) return;
    activeTask.finishedAt = new Date().toISOString();
    if (code !== 0) {
      activeTask.status = '打开失败';
      activeTask.launchError = `无法打开该页面。请检查网址、网络或登录状态后重试。${errorChunks.length ? '' : ''}`;
    }
  });
  return task;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  if (req.method === 'GET' && url.pathname === '/') {
    const html = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
    return send(res, 200, html, 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/app.css') return send(res, 200, await fs.readFile(path.join(publicDir, 'app.css'), 'utf8'), 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/app.js') return send(res, 200, await fs.readFile(path.join(publicDir, 'app.js'), 'utf8'), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/api/tasks') return send(res, 200, JSON.stringify(await listTasks()));
  if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, JSON.stringify(await getStatus()));
  if (req.method === 'GET' && url.pathname === '/api/captures') return send(res, 200, JSON.stringify(await listCaptures(url.searchParams.get('session') || '')));
  if (req.method === 'GET' && url.pathname === '/api/capture-image') {
    const found = await findCapture(url.searchParams.get('id'), url.searchParams.get('session') || '');
    if (!found) return send(res, 404, JSON.stringify({ error: '未找到截图。' }));
    const image = await fs.readFile(path.join(found.library.directory, found.capture.screenshot)).catch(() => null);
    return image ? send(res, 200, image, 'image/png') : send(res, 404, JSON.stringify({ error: '截图文件不存在。' }));
  }
  if (req.method === 'DELETE' && url.pathname === '/api/captures') {
    try { return send(res, 200, JSON.stringify(await deleteCapture(url.searchParams.get('id'), url.searchParams.get('session') || ''))); }
    catch (error) { return send(res, 404, JSON.stringify({ error: error.message || '删除失败。' })); }
  }
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    try { return send(res, 201, JSON.stringify(await startTask(await readBody(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message || '无法启动采集任务。' })); }
  }
  return send(res, 404, JSON.stringify({ error: '未找到页面。' }));
});

server.listen(port, '127.0.0.1', () => {
  const workbenchUrl = `http://127.0.0.1:${port}`;
  console.log(`竞调工作台已启动：${workbenchUrl}`);
  if (process.argv.includes('--open')) openUrl(workbenchUrl);
});

server.on('error', (error) => {
  // 已有服务时静默退出，不再额外打开本地工作台网页。
  if (error.code === 'EADDRINUSE') { process.exit(0); }
  throw error;
});
