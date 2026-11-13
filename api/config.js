// Devuelve la configuración pública de Supabase según el entorno de Vercel.
// Production  → variables del entorno "Production"  (proyecto Supabase PROD)
// Preview/Dev → variables del entorno "Preview"/"Development" (proyecto Supabase DEV)
// Solo expone la URL y la clave pública (anon): la seguridad la ponen las políticas RLS.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anon: process.env.SUPABASE_ANON_KEY || '',
    env: process.env.VERCEL_ENV || 'development',
  });
}
