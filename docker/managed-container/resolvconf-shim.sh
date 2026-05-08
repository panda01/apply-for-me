#!/bin/sh
# Minimal resolvconf shim for wg-quick. Installed at /usr/local/sbin/resolvconf
# so it shadows Ubuntu's systemd-resolved-backed wrapper (which needs dbus and
# would fail in this container).
#
# wg-quick invokes:
#   resolvconf -a <iface> -m <metric> -x   # apply: read config from stdin → write resolv.conf
#   resolvconf -d <iface> -f               # remove: clear out our changes
#
# We only need to honor the nameserver lines on `-a` and reset on `-d`. The
# extra flags (-m, -x, -f) are accepted but ignored.
set -eu

mode=""
while [ $# -gt 0 ]; do
  case "$1" in
    -a) mode="add" ;;
    -d) mode="del" ;;
    *) ;;  # ignore -m <metric>, -x, -f, the iface name, etc.
  esac
  shift
done

case "$mode" in
  add)
    # Stream piped from wg-quick has lines like "nameserver 10.64.0.1".
    # Write them straight to /etc/resolv.conf, replacing whatever was there.
    cat > /etc/resolv.conf
    ;;
  del)
    # Reset to an empty file so the next add starts clean. We don't try to
    # restore the docker-injected resolv.conf because the WG tunnel is the
    # only path egress is supposed to take.
    : > /etc/resolv.conf
    ;;
  *)
    # Unknown invocation — succeed silently rather than fail wg-quick.
    :
    ;;
esac
