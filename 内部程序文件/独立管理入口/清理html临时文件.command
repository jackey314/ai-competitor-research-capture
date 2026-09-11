#!/bin/zsh

script_dir="$(cd "$(dirname "$0")" && pwd)"
tool_dir="$(cd "$script_dir/../.." && pwd)"
cd "$tool_dir" || exit 1

target="$(pwd)/截图文件/普通截图/html临时文件"

clear
echo "清理 HTML 临时文件"
echo ""

if [[ ! -d "$target" ]]; then
  echo "没有找到 HTML 临时文件夹："
  echo "$target"
  echo ""
  read "?按回车关闭窗口..."
  exit 0
fi

echo "将删除："
echo "$target"
echo ""
read "confirm?确认删除请输入 y 后按回车："

if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
  rm -rf "$target"
  echo ""
  echo "已删除 HTML 临时文件。"
else
  echo ""
  echo "已取消。"
fi

echo ""
read "?按回车关闭窗口..."
