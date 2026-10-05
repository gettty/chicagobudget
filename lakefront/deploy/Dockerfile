# Lakefront: a static site served by Caddy. Build context is dist/ (made by `npm run build`).
FROM caddy:2.8-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY . /srv
RUN rm -f /srv/Dockerfile /srv/Caddyfile
EXPOSE 8080
