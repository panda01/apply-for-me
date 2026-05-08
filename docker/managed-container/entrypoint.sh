#!/usr/bin/env bash
# Container entrypoint: brings up the WireGuard tunnel from the config named
# by $WG_CONFIG_NAME (mounted read-only at /etc/wireguard-configs), then exec's
# the original CMD. Hard-fails on any WG error so all egress is forced through
# wg0 — there is no path for the Node process to start without the tunnel up.
#
# DNS handling: handled entirely by wg-quick, which calls our resolvconf shim
# (installed at /usr/local/sbin/resolvconf during image build) to apply the
# DNS= line from the config to /etc/resolv.conf. No custom logic needed here.
#
# Port-forward reply routing (portable across Docker Desktop and Linux-native
# Docker): when the host publishes a container port, replies to those inbound
# connections must travel back the way they came (out eth0), not out wg0. The
# wg-quick default-route hijack would otherwise black-hole replies whose
# destination falls outside the docker bridge subnet — which is the case on
# Docker Desktop (port-forward proxy lives in 192.168.65.0/24) and on any
# host that connects from a non-bridge address.
#
# We solve this generically with connmark: every NEW TCP connection arriving
# on eth0 gets stamped with mark 0xeeee, the mark is saved to conntrack, and
# on OUTPUT we restore it from conntrack and use a high-priority `ip rule` to
# route marked packets through the main table (which routes via eth0). All
# four rules are scoped to TCP only so they don't clobber WG's own UDP fwmark
# (0xca6c) — restoring connmark on a UDP WG packet would zero its fwmark and
# re-route the encrypted payload back through wg0, breaking the handshake.
set -euo pipefail

if [ -z "${WG_CONFIG_NAME:-}" ]; then
  echo "[entrypoint] WG_CONFIG_NAME env var is required" >&2
  exit 1
fi

SRC_CONFIG="/etc/wireguard-configs/${WG_CONFIG_NAME}.conf"
if [ ! -f "$SRC_CONFIG" ]; then
  echo "[entrypoint] WireGuard config not found: $SRC_CONFIG" >&2
  exit 1
fi

mkdir -p /etc/wireguard
cp "$SRC_CONFIG" /etc/wireguard/wg0.conf
chmod 600 /etc/wireguard/wg0.conf

echo "[entrypoint] Bringing up WireGuard interface wg0 (config: $WG_CONFIG_NAME)"
wg-quick up wg0

echo "[entrypoint] Installing connmark rules so port-forward replies use eth0"
iptables -t mangle -A PREROUTING -i eth0 -p tcp -m conntrack --ctstate NEW -j CONNMARK --set-mark 0xeeee
iptables -t mangle -A PREROUTING -p tcp -j CONNMARK --restore-mark
iptables -t mangle -A OUTPUT -p tcp -j CONNMARK --restore-mark
ip rule add fwmark 0xeeee table main priority 100

exec "$@"
