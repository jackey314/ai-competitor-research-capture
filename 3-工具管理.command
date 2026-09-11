#!/bin/zsh

cd "$(dirname "$0")" || exit 1

tool_dir="$(pwd)"
shots_dir="$tool_dir/截图文件"
normal_dir="$shots_dir/普通截图"
flow_dir="$shots_dir/批量走查"
profile_dir="$tool_dir/浏览器资料"
node_bin="/Users/afly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [[ ! -x "$node_bin" ]]; then
  node_bin="$(command -v node)"
fi

mkdir -p "$normal_dir" "$flow_dir" "$profile_dir"

pause() {
  echo ""
  read "?按回车继续..."
}

confirm() {
  local message="$1"
  read "answer?$message 输入 y 确认，直接回车取消："
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

clean_normal() {
  clear
  echo "清理普通截图素材"
  echo ""
  echo "将清理："
  echo "$normal_dir"
  echo ""
  echo "包含 PNG、JSON、HTML 临时文件和运行日志。"
  echo ""
  if confirm "确认清理普通截图素材吗？"; then
    find "$normal_dir" -maxdepth 1 -type f \( -name "*.png" -o -name "*.json" -o -name "_last-run.log" \) -delete
    rm -rf "$normal_dir/html临时文件"
    echo "已清理普通截图素材。"
  else
    echo "已取消。"
  fi
  pause
}

clean_flow_tasks() {
  clear
  echo "清理批量走查任务包"
  echo ""
  echo "将清理："
  echo "$flow_dir"
  echo ""
  echo "会删除所有批量流程任务包、截图、HTML、报告和日志。"
  echo ""
  if confirm "确认清理所有批量走查任务包吗？"; then
    find "$flow_dir" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
    find "$flow_dir" -maxdepth 1 -type f -name "_last-flow-run.log" -delete
    echo "已清理批量走查任务包。"
  else
    echo "已取消。"
  fi
  pause
}

clean_all_html() {
  clear
  echo "清理所有 HTML 临时文件"
  echo ""
  echo "将清理普通截图和批量走查任务包里的 html临时文件。"
  echo ""
  if confirm "确认清理所有 HTML 临时文件吗？"; then
    rm -rf "$normal_dir/html临时文件"
    find "$flow_dir" -mindepth 2 -maxdepth 2 -type d -name "html临时文件" -exec rm -rf {} +
    echo "已清理所有 HTML 临时文件。"
  else
    echo "已取消。"
  fi
  pause
}

clean_browser_cache() {
  clear
  echo "清理浏览器缓存"
  echo ""
  if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
    echo "没有找到 Node.js，无法清理浏览器缓存。"
    pause
    return
  fi
  "$node_bin" ./内部程序文件/截图程序.mjs --cleanup-browser-cache --profile-dir "$profile_dir"
  pause
}

while true; do
  clear
  echo "截图工具管理"
  echo ""
  echo "工具位置：$tool_dir"
  echo ""
  echo "1) 打开截图文件夹"
  echo "2) 清理普通截图素材"
  echo "3) 清理批量走查任务包"
  echo "4) 清理所有 HTML 临时文件"
  echo "5) 清理浏览器缓存"
  echo "6) 安装/修复依赖"
  echo "7) 打包发送工具"
  echo "8) 查看使用说明"
  echo "0) 退出"
  echo ""
  read "choice?请输入数字后按回车，直接回车默认 0："
  choice="${choice:-0}"

  case "$choice" in
    1)
      open "$shots_dir"
      ;;
    2)
      clean_normal
      ;;
    3)
      clean_flow_tasks
      ;;
    4)
      clean_all_html
      ;;
    5)
      clean_browser_cache
      ;;
    6)
      ./内部程序文件/首次使用-安装依赖.command
      ;;
    7)
      ./内部程序文件/独立管理入口/打包发送.command
      ;;
    8)
      open "$tool_dir/使用说明.md"
      ;;
    0)
      break
      ;;
    *)
      echo "没有这个选项。"
      pause
      ;;
  esac
done

echo ""
echo "工具管理已结束。"
echo ""
read "?按回车关闭窗口..."
