const params = new URLSearchParams(location.hash.replace(/^#/, ''));
export const token = params.get('token') || '';

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Layout-Token': token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: { code: 'E_BAD_RESPONSE', message: 'invalid JSON from server' } };
  }
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error && data.error.message ? data.error.message : 'HTTP ' + res.status);
    error.code = data.error && data.error.code ? data.error.code : 'E_HTTP';
    throw error;
  }
  return data.value;
}
