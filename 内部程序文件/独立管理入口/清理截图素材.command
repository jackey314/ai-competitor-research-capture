#!/bin/zsh

script_dir="$(cd "$(dirname "$0")" && pwd)"
tool_dir="$(cd "$script_dir/../.." && pwd)"
cd "$tool_dir" || exit 1
output_dir="$(pwd)/截图文件/普通截图"

echo "清理截图素材"
echo ""
echo "将删除："
echo "  - 截图文件里的 PNG 截图"
echo "  - 截图文件里的 JSON 元数据"
echo "  - 截图文件里的 HTML 临时文件"
echo "  - 最近一次运行日志"
echo ""
echo "不会删除："
echo "  - 工具本体"
echo "  - 使用说明"
echo "  - 浏览器资料（登录状态/地址栏记录）"
echo "  - 批量走查任务包"
echo ""

read "confirm?确认清理请输入 y，直接回车取消："
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "已取消。"
  read "?按回车关闭窗口..."
  exit 0
fi

if [[ -d "$output_dir" ]]; then
  find "$output_dir" -maxdepth 1 -type f \( -name "*.png" -o -name "*.json" -o -name "_last-run.log" \) -delete
  rm -rf "$output_dir/html临时文件"
fi

echo "已清理截图素材。"
echo ""
read "?按回车关闭窗口..."
