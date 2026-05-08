FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# WireGuard (meta-package — pulls in wireguard-tools and recommends modules)
# plus the routing utilities entrypoint.sh needs to install the port-forward
# reply rules. A minimal resolvconf shim is also dropped in so wg-quick can
# apply the DNS= line from the config without us having to strip+rewrite
# /etc/resolv.conf manually — Noble ships a systemd-resolved-backed resolvconf
# that needs dbus, which we don't have.
RUN apt-get update \
  && apt-get install -y --no-install-recommends wireguard iproute2 iptables \
  && rm -rf /var/lib/apt/lists/*

COPY resolvconf-shim.sh /usr/local/sbin/resolvconf
RUN chmod +x /usr/local/sbin/resolvconf

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY server.ts ./
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "start"]
