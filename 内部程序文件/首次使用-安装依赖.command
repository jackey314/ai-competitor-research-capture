#!/bin/zsh

cd "$(dirname "$0")" || exit 1

echo "安装通用截图工具依赖"
echo ""
echo "这个发送包默认不包含大型依赖和浏览器内核。"
echo "安装时只安装轻量的 playwright-core，并使用你电脑上已有的 Edge / Chrome。"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。"
  echo "请先安装 Node.js，然后再双击这个文件。"
  echo "下载地址：https://nodejs.org/"
  echo ""
  read "?按回车关闭窗口..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "没有找到 npm。请确认 Node.js 安装完整。"
  echo ""
  read "?按回车关闭窗口..."
  exit 1
fi

echo "正在安装依赖..."
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund
exit_code=$?

echo ""
if [[ "$exit_code" == "0" ]]; then
  echo "依赖安装完成。之后可以回到上一级文件夹，双击「1-通用截图.command」使用。"
else
  echo "依赖安装失败。请把这个窗口里的错误信息发给工具提供者。"
fi

echo ""
read "?按回车关闭窗口..."
exit "$exit_code"
