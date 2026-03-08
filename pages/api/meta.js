// pages/api/meta.js
// Corre en el servidor — sin problemas de CORS
// Token: primero usa el que viene del cliente, si no hay usa META_TOKEN del entorno (Vercel env var)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { path, params, token: clientToken } = req.body;
  const token = clientToken || process.env.META_TOKEN;

  if (!token || !path) {
    return res.status(400).json({ error: 'Missing token or path' });
  }

  try {
    const url = new URL(`https://graph.facebook.com/v21.0${path}`);
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
