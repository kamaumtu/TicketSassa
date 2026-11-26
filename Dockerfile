FROM node:22-alpine

WORKDIR /app

# Install admin-ui and backend dependencies (public storefront is hosted on Cloudflare Workers)
COPY frontend/admin-ui/package.json frontend/admin-ui/package-lock.json ./frontend/admin-ui/
RUN npm --prefix frontend/admin-ui ci --include=dev

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev

# Copy application source
COPY . .

# Build Admin UI bundle only
RUN npm --prefix frontend run build:admin

ENV NODE_ENV=production
ENV PORT=8000
ENV HOST=0.0.0.0

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "--prefix", "backend", "start"]
