#!/usr/bin/env bash
# 准备 dsh 运行时: node.exe + 固定版本 @deepseek-ai/dsh (0.1.0-rc.6)
set -e
cd "$(dirname "$0")/.."
RUNTIME=runtime-bundle/runtime
DSH_VERSION=0.1.0-rc.6
NODE_VER=v22.23.2

mkdir -p "$RUNTIME"
cd "$RUNTIME"

if [ ! -f node.exe ]; then
  echo "[1/4] downloading node $NODE_VER"
  curl -sL --max-time 300 -o node.zip "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-win-x64.zip"
  unzip -o -q node.zip "node-$NODE_VER-win-x64/node.exe"
  mv "node-$NODE_VER-win-x64/node.exe" .
  rm -rf node.zip "node-$NODE_VER-win-x64"
  echo "node.exe ready"
fi

if [ ! -f package.json ]; then
  npm init -y > /dev/null 2>&1
fi

echo "[2/4] installing pinned @deepseek-ai/dsh@$DSH_VERSION (node-pty scripts allowed)"
npm install --allow-scripts=node-pty "@deepseek-ai/dsh@$DSH_VERSION" 2>&1 | tail -3

echo "[3/4] node-pty native module check"
# npm 12 可能留下空的顶层 node-pty 残留, 真实包嵌套在 dsh-subprocess-local 下
rm -rf node_modules/node-pty
NP=node_modules/@deepseek-ai/dsh-subprocess-local/node_modules/node-pty
if [ -d "$NP/prebuilds/win32-x64" ] && [ ! -f "$NP/build/Release/pty.node" ]; then
  echo "  linking prebuilt native modules"
  mkdir -p "$NP/build/Release"
  cp -r "$NP/prebuilds/win32-x64/." "$NP/build/Release/"
fi
if [ -f "$NP/build/Release/pty.node" ]; then
  echo "node-pty OK"
else
  echo "WARNING: node-pty missing (dsh 内终端功能可能降级)"
fi

echo "[3.5/4] pruning (调试符号/源码映射/非本平台预编译包)"
find "$RUNTIME/node_modules" -name "*.pdb" -delete 2>/dev/null || true
find "$RUNTIME/node_modules" -name "*.map" -delete 2>/dev/null || true
rm -rf "$NP/prebuilds/darwin-arm64" "$NP/prebuilds/darwin-x64" "$NP/prebuilds/win32-arm64" 2>/dev/null || true
rm -rf "$RUNTIME/node_modules/.cache" 2>/dev/null || true

echo "[4/4] smoke test"
./node.exe node_modules/@deepseek-ai/dsh/lib/bin.js --version
echo "RUNTIME READY"
