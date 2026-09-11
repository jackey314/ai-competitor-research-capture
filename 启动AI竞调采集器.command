#!/bin/zsh

cd "$(dirname "$0")"
node_bin="/Users/afly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$node_bin" ]]; then node_bin="$(command -v node)"; fi
if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  echo "未找到启动所需的运行环境。"
  read "?按回车关闭窗口..."
  exit 1
fi

mkdir -p "./截图文件"
nohup "$node_bin" "./内部程序文件/竞调工作台服务.mjs" --open >> "./截图文件/竞调工作台.log" 2>&1 &
exit 0
