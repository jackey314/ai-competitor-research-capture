#!/bin/zsh

cd "$(dirname "$0")"
output_dir="$(pwd)/截图文件/普通截图"
research_dir="$(pwd)/截图文件/竞调素材库"
profile_dir="$(pwd)/浏览器资料"
mkdir -p "$output_dir"
mkdir -p "$research_dir"
mkdir -p "$profile_dir"
node_bin="/Users/afly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [[ ! -x "$node_bin" ]]; then
  node_bin="$(command -v node)"
fi

if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  echo "没有找到 Node.js，截图工具无法运行。"
  echo "请回到 Codex 告诉它：截图工具找不到 Node。"
  read "?按回车关闭窗口..."
  exit 1
fi

clear
log_file="$output_dir/_last-run.log"
echo "运行时间：$(date '+%Y-%m-%d %H:%M:%S')" > "$log_file"
echo "保存位置：$output_dir" >> "$log_file"
echo "浏览器资料：$profile_dir" >> "$log_file"
echo "" >> "$log_file"

set +e
"$node_bin" ./内部程序文件/截图程序.mjs --wizard --out-dir "$output_dir" --profile-dir "$profile_dir" --research-panel --research-dir "$research_dir" 2>&1 | tee -a "$log_file"
exit_code=${pipestatus[1]}
set -e

if [[ "$exit_code" != "0" ]]; then
  echo ""
  echo "截图失败了，错误日志已保存到："
  echo "$log_file"
  echo ""
  echo "你可以回到 Codex 告诉我：截图失败了，帮我读日志。"
  echo ""
  read "?按回车关闭窗口..."
  exit "$exit_code"
fi

echo ""
echo "通用截图工具已结束。截图和元数据在："
echo "$output_dir"
echo ""
echo "如果刚刚截图成功，你可以回到 Codex 告诉我：截图好了。"
echo ""
read "?按回车关闭窗口..."
