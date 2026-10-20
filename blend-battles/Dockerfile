FROM node:22-alpine

WORKDIR /app

# The app has no runtime dependencies — only the sources are needed.
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# Seed data ships with the image; mount a volume at /app/data in production.
COPY data ./data

ENV NODE_ENV=production
ENV PORT=4173
EXPOSE 4173

CMD ["npm", "start"]
