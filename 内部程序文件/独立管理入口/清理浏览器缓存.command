#!/bin/zsh

script_dir="$(cd "$(dirname "$0")" && pwd)"
tool_dir="$(cd "$script_dir/../.." && pwd)"
cd "$tool_dir" || exit 1

profile_dir="$(pwd)/浏览器资料"
node_bin="/Users/afly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [[ ! -x "$node_bin" ]]; then
  node_bin="$(command -v node)"
fi

clear
echo "清理浏览器缓存"
echo ""
echo "目标文件夹："
echo "$profile_dir"
echo ""
echo "将清理："
echo "  - 浏览器 Cache / Code Cache"
echo "  - GPU / 图形缓存"
echo "  - 可重新生成的安全列表、模型缓存和指标文件"
echo ""
echo "会尽量保留："
echo "  - 登录状态 / Cookie"
echo "  - Local Storage / IndexedDB"
echo "  - 历史记录和地址栏记录"
echo ""
echo "请先关闭截图工具打开的浏览器窗口，再执行清理。"
echo ""

if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  echo "没有找到 Node.js，无法清理。"
  echo "请回到 Codex 告诉它：清理浏览器缓存找不到 Node。"
  echo ""
  read "?按回车关闭窗口..."
  exit 1
fi

if [[ ! -d "$profile_dir" ]]; then
  echo "没有找到浏览器资料文件夹。"
  echo "如果你还没运行过截图工具，这是正常的。"
  echo ""
  read "?按回车关闭窗口..."
  exit 0
fi

read "confirm?确认清理请输入 y，直接回车取消："
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo ""
  echo "已取消。"
  echo ""
  read "?按回车关闭窗口..."
  exit 0
fi

"$node_bin" ./内部程序文件/截图程序.mjs --cleanup-browser-cache --profile-dir "$profile_dir"
exit_code=$?

echo ""
if [[ "$exit_code" == "0" ]]; then
  echo "浏览器缓存清理完成。"
else
  echo "浏览器缓存清理失败。"
fi
echo ""
read "?按回车关闭窗口..."
exit "$exit_code"
