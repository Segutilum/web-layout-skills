import { sendJson, readJsonBody, checkToken, originOk } from './http.mjs';

function statusFor(code) {
  if (code === 'E_PAGE_NOT_FOUND') return 404;
  if (code === 'E_FORBIDDEN') return 403;
  if (code === 'E_TOO_LARGE') return 413;
  if (code === 'E_INTERNAL') return 500;
  return 400;
}

export function createApiHandler({ workspace, config, getEditorOrigin, getPreviewOrigin, shutdown }) {
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    if (!checkToken(req, config.editorToken)) {
      sendJson(res, 403, { ok: false, error: { code: 'E_FORBIDDEN', message: 'invalid token' } });
      return true;
    }
    if ((req.method === 'PUT' || req.method === 'POST') && !originOk(req, getEditorOrigin())) {
      sendJson(res, 403, { ok: false, error: { code: 'E_FORBIDDEN', message: 'invalid origin' } });
      return true;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/pages') {
        sendJson(res, 200, { ok: true, value: { pages: await workspace.pages() } });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const page = url.searchParams.get('page') || '';
        const state = await workspace.state(page);
        sendJson(res, 200, {
          ok: true,
          value: {
            ...state,
            editorOrigin: getEditorOrigin(),
            previewOrigin: getPreviewOrigin(),
            runtimeToken: config.runtimeToken,
          },
        });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/version') {
        const page = url.searchParams.get('page') || '';
        sendJson(res, 200, { ok: true, value: await workspace.version(page) });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/manifest') {
        const page = url.searchParams.get('page') || '';
        sendJson(res, 200, { ok: true, value: await workspace.manifest(page) });
        return true;
      }
      if (req.method === 'PUT' && url.pathname === '/api/manifest') {
        const page = url.searchParams.get('page') || '';
        const body = await readJsonBody(req);
        const candidate = body && typeof body === 'object' && body.manifest !== undefined
          ? body.manifest
          : body;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
          || !Array.isArray(candidate.modules)) {
          throw Object.assign(new Error('manifest must be an object with a modules array'), {
            code: 'E_MANIFEST_INVALID',
          });
        }
        const saved = await workspace.saveEditorManifest(page, candidate);
        sendJson(res, 200, { ok: true, value: saved });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/intent') {
        const body = await readJsonBody(req);
        const result = await workspace.submitIntent(body.intent || body);
        sendJson(res, 200, { ok: true, value: { path: result.path, warnings: result.warnings } });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        sendJson(res, 200, { ok: true, value: { ok: true } });
        setTimeout(() => shutdown(), 20);
        return true;
      }
      sendJson(res, 404, { ok: false, error: { code: 'E_NOT_FOUND', message: 'unknown route' } });
      return true;
    } catch (error) {
      const code = error && error.code ? error.code : 'E_INTERNAL';
      sendJson(res, statusFor(code), {
        ok: false,
        error: { code, message: error && error.message ? error.message : String(error) },
      });
      return true;
    }
  };
}
