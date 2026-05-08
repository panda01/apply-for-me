FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=optional --no-audit --no-fund

COPY tsconfig.json ./
COPY server.ts ./

EXPOSE 3000

CMD ["npm", "start"]
