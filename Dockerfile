FROM node:22-alpine

WORKDIR /app

# Install frontend tooling, admin-ui, and backend dependencies
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci --include=dev

COPY frontend/admin-ui/package.json frontend/admin-ui/package-lock.json ./frontend/admin-ui/
RUN npm --prefix frontend/admin-ui ci --include=dev

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev

# Copy application source
COPY . .

# Build storefront CSS and Admin UI bundle
RUN npm --prefix frontend run build:storefront && npm --prefix frontend run build:admin

ENV NODE_ENV=production
ENV PORT=8000
ENV HOST=0.0.0.0

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "--prefix", "backend", "start"]
