#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const toolDir = path.resolve(import.meta.dirname, '..');
const researchDir = path.join(toolDir, '截图文件', '竞调素材库');
const taskDir = path.join(toolDir, '截图文件', '竞调任务');

function safeName(value, fallback = '竞调任务') {
  const cleaned = String(value || fallback).trim().replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function nowCompact() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function askRequired(rl, prompt) {
  while (true) {
    const value = (await rl.question(prompt)).trim();
    if (value) return value;
    console.log('此项不能为空，请重新填写。');
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    console.clear();
    console.log('AI 短剧竞品调研｜新建采集任务');
    console.log('');
    console.log('这一步只定义本轮研究的起点和目标；不同竞品的流程不需要预先写死。');
    console.log('浏览器打开后，在网页右下角点击「截图入库」逐页采集。');
    console.log('');
    const competitor = await askRequired(rl, '竞品名称：');
    const url = await askRequired(rl, '起始页面网址（完整 URL）：');
    const userTask = await askRequired(rl, '本页要确认的用户任务：');
    const module = (await rl.question('当前模块 / 路径（可直接回车后在截图时填写）：')).trim();
    const taskId = `${safeName(competitor).toUpperCase().slice(0, 12)}-${nowCompact()}`;
    const task = {
      taskId,
      competitor,
      startUrl: url,
      userTask,
      module,
      viewport: '1440x810',
      status: '进行中',
      createdAt: new Date().toISOString(),
      captureGuide: [
        '登录或调整到目标状态。',
        '网页右下角点击「截图入库」。',
        '填写页面名称，确认预览和标注。',
        '点击「确认并同步到飞书」。',
      ],
    };
    await fs.mkdir(taskDir, { recursive: true });
    const taskFile = path.join(taskDir, `${taskId}.json`);
    await fs.writeFile(taskFile, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
    console.log('');
    console.log(`已创建任务 ${taskId}。正在打开统一尺寸（1440×810）的采集浏览器…`);
    const nodeBin = process.execPath;
    const script = path.join(toolDir, '内部程序文件', '截图程序.mjs');
    const profileDir = path.join(toolDir, '浏览器资料');
    const child = spawn(nodeBin, [
      script, url, '竞调任务起始页', '--manual', '--viewport', '1440x810',
      '--out-dir', path.join(toolDir, '截图文件', '普通截图'),
      '--profile-dir', profileDir, '--research-panel', '--research-dir', researchDir,
      '--research-session', competitor, '--research-task-id', taskId,
      '--research-user-task', userTask, '--research-module', module,
    ], { stdio: 'inherit', cwd: toolDir });
    await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`采集工具已退出（${code}）。`)));
    });
  } finally {
    rl.close();
  }
}

main().catch((error) => { console.error(`\n任务启动失败：${error.message}`); process.exitCode = 1; });
