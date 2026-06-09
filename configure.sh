#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo
echo "  正在启动配置界面..."
echo

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local candidates=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "$HOME/.nvm/current/bin/node"
    "$HOME/.volta/bin/node"
    "$HOME/.fnm/current/bin/node"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

if ! NODE_EXE="$(find_node)"; then
  echo "[错误] 未找到 Node.js，请先安装: https://nodejs.org/"
  echo "  macOS 推荐: brew install node"
  echo "  安装后请重新打开终端，或确认 node 已加入 PATH。"
  exit 1
fi

if ! "$NODE_EXE" config-ui/server.mjs; then
  echo
  echo "[错误] 配置服务启动失败"
  exit 1
fi
