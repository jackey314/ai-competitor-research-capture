#!/bin/zsh

script_dir="$(cd "$(dirname "$0")" && pwd)"
internal_dir="$(cd "$script_dir/.." && pwd)"
tool_dir="$(cd "$script_dir/../.." && pwd)"
cd "$tool_dir" || exit 1

package_name="通用截图工具-发送包-$(date '+%Y%m%d-%H%M%S')"
tmp_root="$(mktemp -d)"
package_dir="$tmp_root/$package_name"
zip_path="$(pwd)/$package_name.zip"

mkdir -p "$package_dir"

cp "1-通用截图.command" "$package_dir/"
cp "2-批量流程走查.command" "$package_dir/"
cp "3-工具管理.command" "$package_dir/"
cp "使用说明.md" "$package_dir/"
mkdir -p "$package_dir/内部程序文件/独立管理入口"
cp "$internal_dir/截图程序.mjs" "$package_dir/内部程序文件/"
cp "$internal_dir/流程走查程序.mjs" "$package_dir/内部程序文件/"
cp "$internal_dir/首次使用-安装依赖.command" "$package_dir/内部程序文件/"
cp "$internal_dir/package.json" "$package_dir/内部程序文件/"
cp "$script_dir/打包发送.command" "$package_dir/内部程序文件/独立管理入口/"
cp "$script_dir/清理html临时文件.command" "$package_dir/内部程序文件/独立管理入口/"
cp "$script_dir/清理截图素材.command" "$package_dir/内部程序文件/独立管理入口/"
cp "$script_dir/清理浏览器缓存.command" "$package_dir/内部程序文件/独立管理入口/"

chmod +x "$package_dir"/*.command
chmod +x "$package_dir"/内部程序文件/*.command "$package_dir"/内部程序文件/*.mjs
chmod +x "$package_dir"/内部程序文件/独立管理入口/*.command

echo "正在生成发送包..."
ditto -c -k --sequesterRsrc --keepParent "$package_dir" "$zip_path"
exit_code=$?

rm -rf "$tmp_root"

echo ""
if [[ "$exit_code" == "0" ]]; then
  echo "打包完成："
  echo "$zip_path"
  echo ""
  echo "发送这个 zip 给别人即可。"
  echo "注意：发送包不会包含截图文件、HTML 临时文件、浏览器资料或登录状态。"
  open -R "$zip_path"
else
  echo "打包失败。"
fi

echo ""
read "?按回车关闭窗口..."
exit "$exit_code"
