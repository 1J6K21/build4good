# ── Stage 1: deps ─────────────────────────────────────────────────────────────
# Use the official Puppeteer image; it ships a compatible Chrome + all system libs.
FROM ghcr.io/puppeteer/puppeteer:22 AS deps

# Switch to root to install packages, then drop back to pptruser
USER root

WORKDIR /app

# Copy manifests first so Docker layer-caches npm install
COPY package.json package-lock.json ./

# Install production-only Node deps.
# puppeteer itself is already bundled in the base image's Chrome;
# we still install the npm package so require() works, but skip the
# auto-download of a second browser via PUPPETEER_SKIP_DOWNLOAD.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev

# ── Stage 2: runner ────────────────────────────────────────────────────────────
FROM ghcr.io/puppeteer/puppeteer:22

USER root
WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY package.json ./
COPY server/ ./server/
COPY public/ ./public/
COPY tests/ ./tests/

# Persistent SQLite database lives in a mounted volume → /app/data
# Create the directory so it exists even without a volume mount
RUN mkdir -p /app/data && chown -R pptruser:pptruser /app

# Drop to the non-root pptruser that comes with the base image
USER pptruser

# Expose the port the Express server listens on (overrideable via PORT env var)
EXPOSE 3333

# Health-check: ensures the container is actually serving requests
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+( process.env.PORT||3333)+'/api/auth/config', r => { process.exit(r.statusCode===200?0:1) }).on('error',()=>process.exit(1))"

CMD ["node", "server/index.js"]
