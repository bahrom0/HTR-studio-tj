import { randomUUID } from 'node:crypto';

const json = (response, status, value) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
};

const readBody = async (request, limit = 15 * 1024 * 1024) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Файл превышает лимит 15 МБ.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const configuration = () => {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const bucket = process.env.SUPABASE_BUCKET || 'htr-uploads';
  if (!supabaseUrl || !supabaseKey) {
    throw Object.assign(new Error('Supabase URL или API key не настроены в переменных окружения.'), { status: 500 });
  }
  return { supabaseUrl, supabaseKey, openrouterKey, bucket };
};

const storageHeaders = (key, contentType) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  ...(contentType ? { 'Content-Type': contentType } : {}),
});

const restHeaders = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

const storageUrl = ({ supabaseUrl, bucket }, key) =>
  `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;

const restUrl = ({ supabaseUrl }, table, query = '') =>
  `${supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;

const isUuid = (str) =>
  typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

const getSessionId = (request) => {
  const raw = String(request.headers['x-session-id'] || 'guest').trim();
  return isUuid(raw) ? raw : raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'guest';
};

const ensureSession = async (config, sessionId) => {
  try {
    await fetch(restUrl(config, 'access_sessions'), {
      method: 'POST',
      headers: { ...restHeaders(config.supabaseKey), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: sessionId }),
    });
  } catch (err) {
    console.warn('ensureSession warning:', err);
  }
};

const anonymousAccessSession = (request) => {
  const session = getSessionId(request);
  const userUuid = isUuid(session) ? session : randomUUID();
  const now = new Date().toISOString();
  return {
    authenticated: true,
    expires_at: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString(),
    csrf_token: 'csrf-anon',
    user: {
      id: userUuid,
      email: 'user@tajik-htr.local',
      name: 'Пользователь',
      created_at: now,
      updated_at: now,
    },
  };
};

const getImageDimensions = (buffer) => {
  try {
    if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          if (width > 0 && height > 0) return { width, height };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
  } catch {}
  return { width: 1920, height: 1080 };
};

const listDocuments = async (request, response) => {
  const config = configuration();
  const session = getSessionId(request);
  const upstream = await fetch(
    restUrl(config, 'documents', `owner_session_id=eq.${encodeURIComponent(session)}&deleted_at=is.null&order=created_at.desc&select=*`),
    { headers: restHeaders(config.supabaseKey) }
  );
  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error('Supabase listDocuments error:', errText);
    return json(response, 200, { items: [] });
  }
  const documents = await upstream.json();
  const items = Array.isArray(documents)
    ? documents.map((d) => ({
        id: d.id,
        title: d.title || 'Безымянный документ',
        status: d.status || 'draft',
        revision: Number(d.revision || 1),
        page_count: Number(d.page_count || 1),
        created_at: d.created_at || new Date().toISOString(),
        updated_at: d.updated_at || new Date().toISOString(),
      }))
    : [];
  json(response, 200, { items });
};

const getDocument = async (request, response, documentId) => {
  const config = configuration();
  const upstream = await fetch(
    restUrl(config, 'documents', `id=eq.${encodeURIComponent(documentId)}&select=*,assets(*),pages(*)`),
    { headers: restHeaders(config.supabaseKey) }
  );
  if (!upstream.ok) {
    throw Object.assign(new Error('Документ не найден в Supabase.'), { status: 404 });
  }
  const items = await upstream.json();
  if (!items || !items.length) {
    throw Object.assign(new Error('Документ не найден.'), { status: 404 });
  }
  const doc = items[0];
  json(response, 200, {
    id: doc.id,
    title: doc.title,
    status: doc.status || 'draft',
    revision: Number(doc.revision || 1),
    page_count: Number(doc.page_count || 1),
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  });
};

const deleteDocument = async (request, response, documentId) => {
  const config = configuration();
  const upstream = await fetch(
    restUrl(config, 'documents', `id=eq.${encodeURIComponent(documentId)}`),
    {
      method: 'DELETE',
      headers: restHeaders(config.supabaseKey),
    }
  );
  if (!upstream.ok) {
    throw Object.assign(new Error(`Ошибка удаления документа из Supabase: ${await upstream.text()}`), { status: 502 });
  }
  json(response, 200, { success: true });
};

const upload = async (request, response) => {
  const config = configuration();
  const contentType = request.headers['content-type'] || 'image/jpeg';
  if (!String(contentType).startsWith('image/')) {
    throw Object.assign(new Error('Можно загружать только изображения.'), { status: 415 });
  }
  const bytes = await readBody(request);
  if (!bytes.length) throw Object.assign(new Error('Загруженный файл пуст.'), { status: 422 });

  const session = getSessionId(request);
  const documentId = randomUUID();
  const assetId = randomUUID();
  const pageId = randomUUID();
  const extension = String(contentType).includes('png') ? 'png' : String(contentType).includes('webp') ? 'webp' : 'jpg';
  const key = `${session}/${assetId}.${extension}`;
  const { width, height } = getImageDimensions(bytes);

  // 1. Upload file to Supabase Storage
  const upstream = await fetch(storageUrl(config, key), {
    method: 'POST',
    headers: { ...storageHeaders(config.supabaseKey, String(contentType)), 'x-upsert': 'true' },
    body: bytes,
  });
  if (!upstream.ok) throw Object.assign(new Error(`Supabase Storage: ${await upstream.text()}`), { status: 502 });

  // 2. Persist metadata in Supabase PostgreSQL
  await ensureSession(config, session);
  const rawFilename = request.headers['x-original-filename'];
  const originalFilename = rawFilename ? decodeURIComponent(rawFilename) : `Скан_${new Date().toISOString().slice(0, 10)}`;

  try {
    await fetch(restUrl(config, 'documents'), {
      method: 'POST',
      headers: { ...restHeaders(config.supabaseKey), Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: documentId,
        owner_session_id: session,
        title: originalFilename,
        status: 'draft',
        revision: 1,
      }),
    });

    await fetch(restUrl(config, 'assets'), {
      method: 'POST',
      headers: { ...restHeaders(config.supabaseKey), Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: assetId,
        owner_session_id: session,
        document_id: documentId,
        storage_key: key,
        sha256: assetId,
        byte_size: bytes.length,
        media_type: contentType,
        original_filename: originalFilename,
        width,
        height,
      }),
    });

    await fetch(restUrl(config, 'pages'), {
      method: 'POST',
      headers: { ...restHeaders(config.supabaseKey), Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: pageId,
        document_id: documentId,
        source_asset_id: assetId,
        page_index: 0,
        revision: 1,
      }),
    });
  } catch (err) {
    console.warn('Supabase DB metadata insertion warning:', err);
  }

  // Contract match for web_app parseUpload
  json(response, 201, {
    document_id: documentId,
    page_id: pageId,
    duplicate: false,
    asset: {
      id: assetId,
      media_type: contentType,
      width,
      height,
      preview_url: `/api/v1/assets/${assetId}`,
    },
  });
};

const download = async (key) => {
  const config = configuration();
  if (!key || key.includes('..')) throw Object.assign(new Error('Некорректный ключ файла.'), { status: 400 });
  const upstream = await fetch(storageUrl(config, key), { headers: storageHeaders(config.supabaseKey) });
  if (!upstream.ok) throw Object.assign(new Error('Изображение не найдено в Supabase Storage.'), { status: 404 });
  return { upstream, bytes: Buffer.from(await upstream.arrayBuffer()), config };
};

const assetHandler = async (requestUrl, response, assetId = null) => {
  const config = configuration();
  let key = requestUrl.searchParams.get('storage_key') || '';
  let mediaType = 'image/jpeg';

  if (!key && assetId) {
    try {
      const upstream = await fetch(restUrl(config, 'assets', `id=eq.${encodeURIComponent(assetId)}&select=storage_key,media_type`), {
        headers: restHeaders(config.supabaseKey),
      });
      if (upstream.ok) {
        const rows = await upstream.json();
        if (rows && rows[0]?.storage_key) {
          key = rows[0].storage_key;
          mediaType = rows[0].media_type || mediaType;
        }
      }
    } catch (err) {
      console.warn('asset lookup error:', err);
    }
  }

  if (!key) throw Object.assign(new Error('Изображение не найдено.'), { status: 404 });
  const { upstream, bytes } = await download(key);
  response.statusCode = 200;
  response.setHeader('Content-Type', upstream.headers.get('content-type') || mediaType);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.end(bytes);
};

const getPreparation = async (request, response, pageId) => {
  const config = configuration();
  let documentId = randomUUID();
  let assetId = randomUUID();
  let width = 1920;
  let height = 1080;
  let mediaType = 'image/jpeg';

  try {
    const pageRes = await fetch(restUrl(config, 'pages', `id=eq.${encodeURIComponent(pageId)}&select=*,assets:source_asset_id(*)`), {
      headers: restHeaders(config.supabaseKey),
    });
    if (pageRes.ok) {
      const rows = await pageRes.json();
      if (rows && rows[0]) {
        documentId = rows[0].document_id || documentId;
        const ast = rows[0].assets;
        if (ast) {
          assetId = ast.id || assetId;
          width = ast.width || width;
          height = ast.height || height;
          mediaType = ast.media_type || mediaType;
        }
      }
    }
  } catch (err) {
    console.warn('getPreparation error:', err);
  }

  json(response, 200, {
    document_id: documentId,
    page_id: pageId,
    revision: 1,
    confirmed: true,
    quality_warnings: [],
    source_asset: {
      id: assetId,
      media_type: mediaType,
      width,
      height,
      preview_url: `/api/v1/assets/${assetId}`,
    },
    prepared_asset: null,
    recipe: null,
    recipe_hash: null,
    quality_threshold_version: null,
    quality_metrics: null,
  });
};

const startRecognitionJob = async (request, response, pageId) => {
  const config = configuration();
  const session = getSessionId(request);
  const jobId = randomUUID();

  let documentId = randomUUID();
  let storageKey = '';
  let mediaType = 'image/jpeg';

  try {
    const pageRes = await fetch(restUrl(config, 'pages', `id=eq.${encodeURIComponent(pageId)}&select=*,assets:source_asset_id(*)`), {
      headers: restHeaders(config.supabaseKey),
    });
    if (pageRes.ok) {
      const rows = await pageRes.json();
      if (rows && rows[0]) {
        documentId = rows[0].document_id || documentId;
        storageKey = rows[0].assets?.storage_key || '';
        mediaType = rows[0].assets?.media_type || mediaType;
      }
    }
  } catch (err) {
    console.warn('find page error:', err);
  }

  if (!storageKey) {
    const assetRes = await fetch(restUrl(config, 'assets', `owner_session_id=eq.${encodeURIComponent(session)}&order=created_at.desc&limit=1`), {
      headers: restHeaders(config.supabaseKey),
    });
    if (assetRes.ok) {
      const assets = await assetRes.json();
      if (assets?.[0]) {
        storageKey = assets[0].storage_key;
        documentId = assets[0].document_id || documentId;
        mediaType = assets[0].media_type || mediaType;
      }
    }
  }

  if (!storageKey) {
    throw Object.assign(new Error('Не найден файл страницы для распознавания.'), { status: 404 });
  }

  const { bytes } = await download(storageKey);
  if (!config.openrouterKey) throw Object.assign(new Error('OPENROUTER_API_KEY не настроен.'), { status: 500 });

  const prompt = [
    'Transcribe all visible handwritten or printed Tajik Cyrillic text.',
    'Preserve line order from top to bottom and return plain text only.',
    'Use Tajik letters ғ, ӣ, қ, ӯ, ҳ, ҷ exactly; do not replace them with Russian letters.',
    'Do not explain, guess hidden text, or add markdown.',
  ].join(' ');

  const ai = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://vercel.app',
      'X-Title': 'Tajik HTR Studio',
    },
    body: JSON.stringify({
      model: process.env.HTR_OCR_MODEL || 'google/gemini-2.5-flash',
      temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${bytes.toString('base64')}` } },
      ] }],
    }),
  });

  if (!ai.ok) throw Object.assign(new Error(`OpenRouter Gemini: ${await ai.text()}`), { status: 502 });
  const completion = await ai.json();
  const rawText = String(completion?.choices?.[0]?.message?.content || '').trim() || 'Текст не обнаружен';

  // Persist in DB
  try {
    await fetch(restUrl(config, 'documents', `id=eq.${encodeURIComponent(documentId)}`), {
      method: 'PATCH',
      headers: { ...restHeaders(config.supabaseKey), Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'ready', updated_at: new Date().toISOString() }),
    });

    await fetch(restUrl(config, 'recognition_jobs'), {
      method: 'POST',
      headers: { ...restHeaders(config.supabaseKey), Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: jobId,
        owner_session_id: session,
        document_id: documentId,
        state: 'completed',
        stage: 'completed',
        priority: 0,
        attempts: 1,
        max_attempts: 1,
        processed_count: 1,
        total_count: 1,
        revision: 1,
      }),
    });

    await fetch(restUrl(config, 'page_raw_results'), {
      method: 'POST',
      headers: { ...restHeaders(config.supabaseKey), Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: randomUUID(),
        recognition_run_id: jobId,
        page_id: pageId,
        owner_session_id: session,
        raw_text: rawText,
        is_partial: false,
      }),
    });
  } catch (err) {
    console.warn('Persist recognition error:', err);
  }

  const now = new Date().toISOString();
  // Return JobSnapshot matching parseJobSnapshot
  json(response, 201, {
    id: jobId,
    document_id: documentId,
    page_id: pageId,
    state: 'completed',
    stage: 'completed',
    priority: 0,
    processed_count: 1,
    total_count: 1,
    attempt: 1,
    max_attempts: 1,
    cancellation_requested: false,
    error_code: null,
    error_retryable: false,
    can_cancel: false,
    can_retry: false,
    revision: 1,
    created_at: now,
    updated_at: now,
    duplicate: false,
  });
};

const getJobSnapshot = async (request, response, jobId) => {
  const config = configuration();
  const now = new Date().toISOString();
  let documentId = randomUUID();
  let pageId = randomUUID();

  try {
    const res = await fetch(restUrl(config, 'page_raw_results', `recognition_run_id=eq.${encodeURIComponent(jobId)}&select=*`), {
      headers: restHeaders(config.supabaseKey),
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows && rows[0]) {
        pageId = rows[0].page_id || pageId;
      }
    }
  } catch {}

  json(response, 200, {
    id: jobId,
    document_id: documentId,
    page_id: pageId,
    state: 'completed',
    stage: 'completed',
    priority: 0,
    processed_count: 1,
    total_count: 1,
    attempt: 1,
    max_attempts: 1,
    cancellation_requested: false,
    error_code: null,
    error_retryable: false,
    can_cancel: false,
    can_retry: false,
    revision: 1,
    created_at: now,
    updated_at: now,
    duplicate: false,
  });
};

const getJobResult = async (request, response, jobId) => {
  const config = configuration();
  let rawText = '';
  let documentId = randomUUID();
  let pageId = randomUUID();

  try {
    const res = await fetch(restUrl(config, 'page_raw_results', `recognition_run_id=eq.${encodeURIComponent(jobId)}&select=*`), {
      headers: restHeaders(config.supabaseKey),
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows && rows[0]) {
        rawText = rows[0].raw_text;
        pageId = rows[0].page_id;
      }
    }
  } catch (err) {
    console.warn('getJobResult error:', err);
  }

  json(response, 200, {
    job_id: jobId,
    document_id: documentId,
    page_id: pageId,
    raw_text: rawText || 'Текст не распознан',
    is_partial: false,
  });
};

export default async function handler(request, response) {
  const requestUrl = new URL(request.url, 'https://vercel.local');
  const path = `/${requestUrl.searchParams.get('path') || ''}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  
  try {
    // 1. Health checks
    if (request.method === 'GET' && (path === '/v1/health' || path === '/v1/health/live')) {
      return json(response, 200, {
        status: 'ok',
        request_id: randomUUID(),
        runtime: 'vercel-node',
        database: 'supabase-postgresql',
        storage: 'supabase-storage',
        ocr: 'gemini',
      });
    }

    // 2. Anonymous Access session
    if (request.method === 'GET' && path === '/v1/access/session') {
      return json(response, 200, anonymousAccessSession(request));
    }

    if (request.method === 'POST' && path === '/v1/access/csrf') {
      return json(response, 200, anonymousAccessSession(request));
    }

    // 3. Document list & upload
    if (request.method === 'GET' && path === '/v1/documents') {
      return await listDocuments(request, response);
    }
    if (request.method === 'POST' && (path === '/v1/documents' || path === '/v1/documents/upload')) {
      return await upload(request, response);
    }

    // 4. Asset streaming
    const assetMatch = path.match(/^\/v1\/assets\/([^/]+)$/);
    if (request.method === 'GET' && assetMatch) {
      return await assetHandler(requestUrl, response, assetMatch[1]);
    }
    if (request.method === 'GET' && path === '/v1/assets') {
      return await assetHandler(requestUrl, response);
    }

    // 5. Preparation routes
    const prepMatch = path.match(/^\/v1\/pages\/([^/]+)\/preparation$/);
    if (request.method === 'GET' && prepMatch) {
      return await getPreparation(request, response, prepMatch[1]);
    }
    const prepConfirmMatch = path.match(/^\/v1\/pages\/([^/]+)\/(?:preparation\/confirm|prepare)$/);
    if (request.method === 'POST' && prepConfirmMatch) {
      return await getPreparation(request, response, prepConfirmMatch[1]);
    }

    // 6. Recognition job creation
    const jobCreateMatch = path.match(/^\/v1\/pages\/([^/]+)\/recognition-jobs$/);
    if (request.method === 'POST' && jobCreateMatch) {
      return await startRecognitionJob(request, response, jobCreateMatch[1]);
    }

    // 7. Job status & results
    const jobResultMatch = path.match(/^\/v1\/jobs\/([^/]+)\/result$/);
    if (request.method === 'GET' && jobResultMatch) {
      return await getJobResult(request, response, jobResultMatch[1]);
    }
    const jobSnapMatch = path.match(/^\/v1\/jobs\/([^/]+)$/);
    if (request.method === 'GET' && jobSnapMatch) {
      return await getJobSnapshot(request, response, jobSnapMatch[1]);
    }

    // 8. Document details & delete
    const docMatch = path.match(/^\/v1\/documents\/([^/]+)$/);
    if (docMatch) {
      if (request.method === 'GET') return await getDocument(request, response, docMatch[1]);
      if (request.method === 'DELETE') return await deleteDocument(request, response, docMatch[1]);
    }

    // 9. SSE stream dummy fallback
    if (path === '/events' || path === '/v1/events') {
      response.statusCode = 204;
      return response.end();
    }

    return json(response, 404, { message: 'API route not found.' });
  } catch (error) {
    console.error(error);
    return json(response, error.status || 500, { message: error.message || 'Internal server error.' });
  }
}
