FROM node:20-bookworm-slim

# Baileys pulls one dependency straight from GitHub, so git is needed at install time.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src

RUN mkdir -p /app/sessions && chown -R node:node /app
USER node
ENV NODE_ENV=production GATEWAY_HOST=0.0.0.0 SESSIONS_DIR=/app/sessions
EXPOSE 3100
CMD ["node", "src/server.js"]
