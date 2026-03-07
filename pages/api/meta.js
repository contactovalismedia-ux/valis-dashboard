// pages/api/meta.js
// Este endpoint corre en el SERVIDOR (no en el browser)
// Por eso Meta no bloquea las llamadas — no hay problema de CORS

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { path, params, token } = req.body;

  if (!token || !path) {
    return res.status(400).json({ error: 'Missing token or path' });
  }

  try {
    const url = new URL(`https://graph.facebook.com/v19.0${path}`);
    url.searchParams.set('access_token', token);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
    }

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message, code: data.error.code });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
