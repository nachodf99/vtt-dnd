// Devuelve la configuración de Supabase según el entorno de Vercel.
// Production  → variables del entorno "Production"  (proyecto Supabase PROD)
// Preview/Dev → variables del entorno "Preview"/"Development" (proyecto Supabase DEV)
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anon: process.env.SUPABASE_ANON_KEY || '',
    env: process.env.VERCEL_ENV || 'development',
  });
}
