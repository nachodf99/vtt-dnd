// Para desarrollo en tu máquina SIN Vercel (abrir index.html con un servidor estático):
// 1) copia este archivo como config.local.js
// 2) pon la URL y la clave "anon public" de tu proyecto Supabase de DESARROLLO
// config.local.js está en .gitignore: no se sube al repo.
window.VTT_CONFIG = {
  url: 'https://TU-PROYECTO-DEV.supabase.co',
  anon: 'TU_ANON_KEY_DEV',
  env: 'development',
};
