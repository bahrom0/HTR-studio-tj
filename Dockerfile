# Build the Vite client and serve it from the FastAPI process so the deployed
# application keeps one origin for the UI, API, cookies, and SSE.
FROM node:22-bookworm-slim AS web-build

WORKDIR /build
COPY web_app/package.json web_app/package-lock.json ./web_app/
RUN npm --prefix web_app ci --no-audit --no-fund
COPY web_app ./web_app
RUN npm --prefix web_app run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/api_server \
    HTR_WEB_DIST=/app/web_app/dist

WORKDIR /app

COPY api_server/requirements-cloud.txt ./api_server/requirements-cloud.txt
RUN python -m pip install --no-cache-dir -r api_server/requirements-cloud.txt

COPY api_server ./api_server
COPY --from=web-build /build/web_app/dist ./web_app/dist

EXPOSE 8000

CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
