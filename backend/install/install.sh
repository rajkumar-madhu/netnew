#!/bin/sh
# NetNew agent installer.
#
#   curl -fsSL __NETNEW_URL__/install.sh | sudo sh -s -- --token <AGENT_TOKEN>
#
# Installs the agent to /opt/netnew-agent and runs it as a systemd service.
# Requires Node.js 18+ and npm on the target machine.
set -eu

URL="__NETNEW_URL__"
TOKEN=""
INSTALL_DIR="/opt/netnew-agent"
STATE_DIR="/var/lib/netnew-agent"
ENV_FILE="/etc/netnew-agent.env"
SERVICE_FILE="/etc/systemd/system/netnew-agent.service"

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --uninstall)
      systemctl disable --now netnew-agent 2>/dev/null || true
      rm -rf "$INSTALL_DIR" "$SERVICE_FILE" "$ENV_FILE"
      systemctl daemon-reload 2>/dev/null || true
      echo "NetNew agent removed. Node identity kept in $STATE_DIR."
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

fail() { echo "error: $*" >&2; exit 1; }

[ -n "$TOKEN" ] || fail "--token is required (find it in the server's data/agent-token file)"
[ "$(id -u)" -eq 0 ] || fail "run as root (pipe to 'sudo sh -s -- ...')"
command -v node >/dev/null 2>&1 || fail "Node.js 18+ is required: https://nodejs.org/en/download"
command -v npm >/dev/null 2>&1 || fail "npm is required"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js 18+ is required (found $(node -v))"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  fail "curl or wget is required"
fi

echo "Installing NetNew agent from $URL ..."
mkdir -p "$INSTALL_DIR" "$STATE_DIR"
fetch "$URL/agent/manifest" "$INSTALL_DIR/.manifest"
for f in $(cat "$INSTALL_DIR/.manifest"); do
  mkdir -p "$INSTALL_DIR/$(dirname "$f")"
  fetch "$URL/agent/$f" "$INSTALL_DIR/$f"
done
(cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

umask 077
cat > "$ENV_FILE" <<EOF
NETNEW_URL=$URL
NETNEW_TOKEN=$TOKEN
NETNEW_STATE_DIR=$STATE_DIR
EOF
umask 022

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=NetNew monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $INSTALL_DIR/src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now netnew-agent
  systemctl restart netnew-agent
  echo "NetNew agent is running. Check it with: systemctl status netnew-agent"
else
  echo "systemd not found. Start the agent manually:"
  echo "  set -a; . $ENV_FILE; set +a; node $INSTALL_DIR/src/index.js"
fi
