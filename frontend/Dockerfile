FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

FROM nginx:1.27-alpine
COPY templates /etc/nginx/templates
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
# PORT: listen port (Render sets it). BACKEND_URL: where /api and /ws are proxied.
ENV PORT=80 BACKEND_URL=http://backend:3000
EXPOSE 80
