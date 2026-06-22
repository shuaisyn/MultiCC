#!/usr/bin/env bash
# ios-debug.sh — boot an iOS simulator (prefers iPhone 16) and `flutter run` the app on it.
#
# Usage:
#   ./scripts/ios-debug.sh                 # debug build, hot reload, on iPhone 16 (or first available iPhone)
#   ./scripts/ios-debug.sh --release       # release build
#   ./scripts/ios-debug.sh --device "iPhone 16 Pro"   # target a specific simulator by name
set -euo pipefail

DEVICE_NAME="iPhone 16"
RUN_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --release) RUN_ARGS+=("--release"); shift ;;
    --device)  DEVICE_NAME="${2:-}"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

command -v flutter >/dev/null 2>&1 || { echo "✗ 找不到 flutter，请确认已安装并在 PATH 中。" >&2; exit 1; }
command -v xcrun  >/dev/null 2>&1 || { echo "✗ 找不到 xcrun（需要安装 Xcode 命令行工具）。" >&2; exit 1; }

cd "$(dirname "$0")/.."   # → app/
echo "==> 项目目录：$(pwd)"

# Pick the target simulator UDID: exact name match first, else first available iPhone.
udid="$(xcrun simctl list devices available | awk -v want="$DEVICE_NAME" '
  $0 ~ "^[[:space:]]*"want" \\(" { if (match($0, /\(([0-9A-F-]+)\)/)) { print substr($0, RSTART+1, RLENGTH-2); exit } }')"
if [ -z "${udid:-}" ]; then
  udid="$(xcrun simctl list devices available | awk '
    /iPhone .*\(/ { if (match($0, /\(([0-9A-F-]+)\)/)) { print substr($0, RSTART+1, RLENGTH-2); exit } }')"
  [ -n "${udid:-}" ] && echo "==> 未找到「$DEVICE_NAME」，回退到第一个可用 iPhone 模拟器。"
fi
[ -z "${udid:-}" ] && { echo "✗ 没有可用的 iPhone 模拟器，请在 Xcode 里添加一个。" >&2; exit 1; }
echo "==> 目标模拟器 UDID：$udid"

# Boot it if needed, then open the Simulator UI and wait for full boot.
state="$(xcrun simctl list devices | grep "$udid" | sed -n 's/.*(\(Booted\|Shutdown\)).*/\1/p' | head -1)"
if [ "$state" != "Booted" ]; then
  echo "==> 启动模拟器…"
  xcrun simctl boot "$udid"
fi
open -a Simulator
echo "==> 等待模拟器就绪…"
xcrun simctl bootstatus "$udid" -b || true

echo "==> flutter run -d $udid ${RUN_ARGS[*]:-}"
exec flutter run -d "$udid" "${RUN_ARGS[@]}"
