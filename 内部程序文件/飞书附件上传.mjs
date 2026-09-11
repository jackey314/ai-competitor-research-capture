#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const [filePath, appToken] = process.argv.slice(2);
const configPath = '/Users/afly/.codex/config.toml';
const authStorePath = '/Users/afly/.npm/_npx/74dfe5d932228314/node_modules/@larksuiteoapi/lark-mcp/dist/auth/store.js';

if (!filePath || !appToken) {
  throw new Error('用法：node 飞书附件上传.mjs <截图路径> <多维表格 app_token>');
}

const config = await fs.readFile(configPath, 'utf8');
const appId = config.match(/\[mcp_servers\.feishu\.env\][\s\S]*?APP_ID\s*=\s*"([^"]+)"/)?.[1];
const appSecret = config.match(/\[mcp_servers\.feishu\.env\][\s\S]*?APP_SECRET\s*=\s*"([^"]+)"/)?.[1];
if (!appId || !appSecret) throw new Error('未找到飞书 App ID 或 App Secret。');

// 私有多维表格以用户身份创建；附件也必须以同一 OAuth 用户身份上传。
const { authStore } = await import(authStorePath);
const userAccessToken = await authStore.getLocalAccessToken(appId);
if (!userAccessToken) throw new Error('未找到飞书 OAuth 用户令牌，请先完成 MCP OAuth 授权。');

const file = await fs.readFile(filePath);
const form = new FormData();
form.append('file_name', path.basename(filePath));
form.append('parent_type', 'bitable_image');
form.append('parent_node', appToken);
form.append('size', String(file.length));
form.append('file', new Blob([file], { type: 'image/png' }), path.basename(filePath));

const uploadResponse = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
  method: 'POST',
  headers: { Authorization: `Bearer ${userAccessToken}` },
  body: form,
});
const uploadResult = await uploadResponse.json();
const fileToken = uploadResult?.data?.file_token;
if (uploadResult.code !== 0 || !fileToken) {
  throw new Error(`上传截图失败：${uploadResult.msg || uploadResponse.status}`);
}

console.log(JSON.stringify({ file_token: fileToken }));
