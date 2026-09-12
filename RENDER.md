# Render deployment

This repository is prepared as two Render services from the root
`render.yaml` Blueprint:

- `htr-studio` — Docker Web Service serving the Vite frontend and the full
  FastAPI API from one origin;
- `htr-studio-worker` — Docker Background Worker running the durable OCR queue.

The worker uses the cloud Gemini/OpenRouter path. It does not use the local
Kraken sidecar at `127.0.0.1:8011`.

## Deploy from the dashboard

1. Push the repository to GitHub.
2. In Render choose **New → Blueprint**.
3. Select the repository and the `main` branch.
4. Render will read `render.yaml` and build both services from `Dockerfile`.
5. When Render asks for secret values, enter them for both services:

   - `OPENROUTER_API_KEY` — a new OpenRouter key;
   - `SUPABASE_URL` — for example `https://<project>.supabase.co`;
   - `SUPABASE_SERVICE_ROLE_KEY` — the server-side Supabase key, not the public
     publishable key.

The Supabase schema and `htr-uploads` storage bucket must already exist. The
API uses Supabase for database and file storage; it does not depend on Render's
local filesystem.

## Commands used by Render

The Docker image runs these commands automatically:

```text
Frontend build: npm --prefix web_app run build
API:            python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
Worker:         python -m app.worker.main
```

After deployment, check:

```text
https://<htr-studio-service>.onrender.com/api/v1/health/live
```

Then open the service root URL. The old Vercel URL will not switch to Render
automatically; use the Render URL or add a deliberate proxy/custom-domain
configuration later.
