import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeScreenshotWithVision } from './竞调采集面板.mjs';
import { syncCaptureToFeishu } from './飞书竞调同步.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function safeName(value) {
  return String(value || '未命名竞品')
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || '未命名竞品';
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch { return fallback; }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function applyAnalysis(capture, result) {
  capture.observation = String(result.observation || '').trim();
  capture.analysis = String(result.analysis || '').trim();
  capture.toVerify = String(result.toVerify || '').trim();
  capture.uxEvidence = {
    state: result.uxState || '常规',
    trigger: String(result.trigger || '').trim(),
    feedback: String(result.feedback || '').trim(),
    recovery: String(result.recovery || '').trim(),
    accessibility: String(result.accessibility || '').trim(),
  };
  capture.syncStatus = '待同步';
  capture.updatedAt = new Date().toISOString();
}

async function main() {
  const session = process.argv[2] || 'Oiloil';
  const shouldSync = process.argv.includes('--sync');
  const directory = path.join(rootDir, '截图文件', '竞调素材库', safeName(session).toLowerCase());
  const indexPath = path.join(directory, 'index.json');
  const index = await readJson(indexPath, null);
  if (!index?.captures) throw new Error(`没有找到 ${session} 的截图索引。`);

  const pending = index.captures.filter((capture) => (
    !String(capture.analysis || '').trim()
    || (shouldSync && capture.feishu_sync?.status !== 'synced')
  ));
  if (!pending.length) {
    console.log(JSON.stringify({ session, analyzed: 0, message: '没有待分析截图。' }));
    return;
  }

  const completed = [];
  const failed = [];
  for (const capture of pending) {
    try {
      const metadataFilename = capture.metadataFilename || `${capture.id}-${safeName(capture.name)}.json`;
      if (!String(capture.analysis || '').trim()) {
        const result = await analyzeScreenshotWithVision({ directory }, capture);
        applyAnalysis(capture, result);
        await writeJson(path.join(directory, 'metadata', metadataFilename), capture);
        index.updatedAt = new Date().toISOString();
        await writeJson(indexPath, index);
      }
      if (shouldSync) {
        const synced = await syncCaptureToFeishu({ researchDir: path.dirname(directory), library: { directory }, capture });
        Object.assign(capture, synced.capture);
        capture.syncStatus = '已同步';
        await writeJson(path.join(directory, 'metadata', metadataFilename), capture);
        index.updatedAt = new Date().toISOString();
        await writeJson(indexPath, index);
      }
      completed.push(capture.id);
    } catch (error) {
      failed.push({ id: capture.id, message: error instanceof Error ? error.message : '未知错误' });
    }
  }
  console.log(JSON.stringify({ session, analyzed: completed, failed }));
  if (failed.length) process.exitCode = 1;
}

await main();
