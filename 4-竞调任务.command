#!/bin/zsh

cd "$(dirname "$0")"
node_bin="/Users/afly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$node_bin" ]]; then
  node_bin="$(command -v node)"
fi

if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  echo "没有找到运行环境，无法启动竞调任务。"
  read "?按回车关闭窗口..."
  exit 1
fi

"$node_bin" ./内部程序文件/竞调任务启动器.mjs
exit_code=$?
if [[ "$exit_code" != "0" ]]; then
  echo ""
  echo "竞调任务未完成。你可以回到 Codex 告诉我错误信息。"
  read "?按回车关闭窗口..."
fi
exit "$exit_code"
