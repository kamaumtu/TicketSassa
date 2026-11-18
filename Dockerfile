FROM node:22-alpine

WORKDIR /app

# Install root, admin-ui, and backend dependencies
COPY package.json package-lock.json ./
RUN npm ci

COPY admin-ui/package.json admin-ui/package-lock.json ./admin-ui/
RUN npm --prefix admin-ui ci

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev

# Copy application source
COPY . .

# Build storefront CSS, Admin UI bundle, and signed Android APK
RUN npm run build:storefront && npm run build:admin && npm run build:apk

ENV NODE_ENV=production
ENV PORT=8000
ENV HOST=0.0.0.0

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "--prefix", "backend", "start"]
