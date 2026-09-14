#!/usr/bin/env node

/**
 * 飞书竞调素材同步适配层。
 *
 * 不保存 App Secret。截图工具复用本机已完成 OAuth 授权的飞书用户令牌；
 * 表格定位信息保存在竞调素材库根目录的「飞书同步配置.json」。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG_PATH = '/Users/afly/.codex/config.toml';
const AUTH_STORE_PATH = '/Users/afly/.npm/_npx/74dfe5d932228314/node_modules/@larksuiteoapi/lark-mcp/dist/auth/store.js';

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function getFeishuUserAccessToken() {
  const config = await fs.readFile(DEFAULT_CONFIG_PATH, 'utf8');
  const appId = config.match(/\[mcp_servers\.feishu\.env\][\s\S]*?APP_ID\s*=\s*"([^"]+)"/)?.[1];
  const appSecret = config.match(/\[mcp_servers\.feishu\.env\][\s\S]*?APP_SECRET\s*=\s*"([^"]+)"/)?.[1];
  if (!appId || !appSecret) throw new Error('没有找到已配置的飞书应用。请先完成飞书授权。');
  const { authStore } = await import(AUTH_STORE_PATH);
  const accessToken = await authStore.getLocalAccessToken(appId);
  if (!accessToken) throw new Error('本机尚未完成飞书授权。请先在 Codex 中完成飞书 OAuth 授权。');
  const stored = await authStore.getToken(accessToken);
  if (!stored?.expiresAt || stored.expiresAt > Date.now() / 1000 + 30) return accessToken;
  if (!stored.extra?.refreshToken) throw new Error('飞书登录已过期，请重新完成 OAuth 授权后再同步。');
  try {
    const { LarkOIDC2OAuthServerProvider } = await import('/Users/afly/.npm/_npx/74dfe5d932228314/node_modules/@larksuiteoapi/lark-mcp/dist/auth/provider/oidc.js');
    const provider = new LarkOIDC2OAuthServerProvider({ domain: 'https://open.feishu.cn', appId, appSecret });
    const next = await provider.exchangeRefreshToken(
      { client_id: stored.clientId, redirect_uris: [] }, stored.extra.refreshToken, stored.scopes,
    );
    await authStore.removeToken(accessToken);
    await authStore.storeLocalAccessToken(next.access_token, appId);
    return next.access_token;
  } catch {
    throw new Error('飞书登录已过期，请重新完成 OAuth 授权后再同步。');
  }
}

async function feishuFetch(url, options = {}) {
  const userAccessToken = await getFeishuUserAccessToken();
  const response = await fetch(`https://open.feishu.cn${url}`, {
    ...options,
    headers: { Authorization: `Bearer ${userAccessToken}`, ...(options.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) {
    throw new Error(result.msg || `飞书请求失败（${response.status}）`);
  }
  return result.data;
}

export async function readFeishuSyncConfig(researchDir) {
  const configPath = path.join(researchDir, '飞书同步配置.json');
  const config = await readJson(configPath);
  if (!config?.appToken || !config?.tableId) {
    throw new Error('尚未配置飞书表格。请先在「飞书同步配置.json」中确认 appToken 和 tableId。');
  }
  return { ...config, configPath };
}

export async function syncCaptureToFeishu({ researchDir, library, capture }) {
  const config = await readFeishuSyncConfig(researchDir);
  let fileToken = capture.feishu_sync?.attachment_file_token;
  if (!fileToken) {
    const imagePath = path.join(library.directory, capture.screenshot);
    const image = await fs.readFile(imagePath);
    const form = new FormData();
    form.append('file_name', capture.filename);
    form.append('parent_type', 'bitable_image');
    form.append('parent_node', config.appToken);
    form.append('size', String(image.length));
    form.append('file', new Blob([image], { type: 'image/png' }), capture.filename);
    const uploaded = await feishuFetch('/open-apis/drive/v1/medias/upload_all', { method: 'POST', body: form });
    fileToken = uploaded.file_token;
  }
  const fields = {
    '编号': capture.id,
    '模块/路径': capture.module || capture.name,
    '用户任务': capture.userTask || '待补充',
    '截图': [{ file_token: fileToken }],
    '观察事实': capture.observation || capture.note || '待分析',
    '分析解读': capture.analysis || '待分析',
    '证据等级': capture.evidenceLevel || 'A',
    '待验证': capture.toVerify || '待补充',
  };
  const existingRecordId = capture.feishu_sync?.record_id;
  const endpoint = existingRecordId
    ? `/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records/${existingRecordId}`
    : `/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`;
  const result = await feishuFetch(
    endpoint,
    { method: existingRecordId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) },
  );
  const record = result.record;
  capture.feishu_sync = {
    status: 'synced',
    app_token: config.appToken,
    table_id: config.tableId,
    record_id: record?.record_id || existingRecordId,
    attachment_file_token: fileToken,
    synced_at: new Date().toISOString(),
  };
  return { capture, record, updated: Boolean(existingRecordId), tableUrl: config.tableUrl || '' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [researchDir, libraryDir, metadataFilename] = process.argv.slice(2);
  if (!researchDir || !libraryDir || !metadataFilename) {
    throw new Error('用法：node 飞书竞调同步.mjs <竞调素材库根目录> <竞品目录> <元数据文件名>');
  }
  const capture = await readJson(path.join(libraryDir, 'metadata', metadataFilename));
  if (!capture) throw new Error('没有找到要同步的截图元数据。');
  const synced = await syncCaptureToFeishu({ researchDir, library: { directory: libraryDir }, capture });
  await writeJson(path.join(libraryDir, 'metadata', metadataFilename), synced.capture);
  console.log(JSON.stringify({ record_id: synced.capture.feishu_sync.record_id }));
}
