FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# WireGuard (meta-package — pulls in wireguard-tools and recommends modules)
# plus the routing utilities entrypoint.sh needs to install the port-forward
# reply rules. A minimal resolvconf shim is also dropped in so wg-quick can
# apply the DNS= line from the config without us having to strip+rewrite
# /etc/resolv.conf manually — Noble ships a systemd-resolved-backed resolvconf
# that needs dbus, which we don't have.
#
# xvfb + dbus-x11 are needed so we can run Chromium in *headed* mode against
# a virtual display (DISPLAY=:99 set by entrypoint.sh). Headless Chromium has
# a few residual fingerprints that even puppeteer-extra-plugin-stealth can't
# fully scrub — running headed reduces them at the cost of more memory/CPU.
RUN apt-get update \
  && apt-get install -y --no-install-recommends wireguard iproute2 iptables xvfb dbus-x11 \
  && rm -rf /var/lib/apt/lists/*

COPY resolvconf-shim.sh /usr/local/sbin/resolvconf
RUN chmod +x /usr/local/sbin/resolvconf

COPY package.json ./
RUN npm install --no-audit --no-fund

# patchright ships its own patched chromium build. Even though the Microsoft
# playwright base image already has a chromium at /ms-playwright, patchright's
# patches require its specific binary, so install it into the same browsers
# path the playwright image uses.
RUN npx patchright install chromium

COPY tsconfig.json ./
COPY server.ts ./
COPY agent.ts ./
COPY popup.ts ./
COPY smartproxy.ts ./
COPY resolutionProgressStore.ts ./
COPY resolutionTypes.ts ./
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "start"]
