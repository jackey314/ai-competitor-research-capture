#!/bin/zsh

cd "$(dirname "$0")" || exit 1

node_bin="/Users/afly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$node_bin" ]]; then
  node_bin="$(command -v node)"
fi

if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  echo "没有找到 Node.js，批量流程走查无法运行。"
  echo "请回到 Codex 告诉它：批量流程走查找不到 Node。"
  read "?按回车关闭窗口..."
  exit 1
fi

mkdir -p "$(pwd)/截图文件/批量走查"
mkdir -p "$(pwd)/浏览器资料"

clear
log_file="$(pwd)/截图文件/批量走查/_last-flow-run.log"
echo "运行时间：$(date '+%Y-%m-%d %H:%M:%S')" > "$log_file"
echo "保存位置：$(pwd)/截图文件/批量走查" >> "$log_file"
echo "浏览器资料：$(pwd)/浏览器资料" >> "$log_file"
echo "" >> "$log_file"

set +e
"$node_bin" ./内部程序文件/流程走查程序.mjs \
  --out-dir "$(pwd)/截图文件/批量走查" \
  --profile-dir "$(pwd)/浏览器资料" 2>&1 | tee -a "$log_file"
exit_code=${pipestatus[1]}
set -e

if [[ "$exit_code" != "0" ]]; then
  echo ""
  echo "批量流程走查失败，错误日志已保存到："
  echo "$log_file"
  echo ""
  echo "你可以回到 Codex 告诉我：批量流程走查失败了，帮我读日志。"
  echo ""
  read "?按回车关闭窗口..."
  exit "$exit_code"
fi

echo ""
echo "批量流程走查工具已结束。"
echo ""
echo "你可以回到 Codex 告诉我：流程走查截图好了。"
echo ""
read "?按回车关闭窗口..."
