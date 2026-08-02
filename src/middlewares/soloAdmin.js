// Middleware de acceso exclusivo para admin y coordinador
// Úsalo en rutas sensibles DESPUÉS de requireAuth

export function soloAdmin(req, res, next) {
  const usuario = req.session?.usuario;

  if (!usuario) {
    return res.status(401).json({ error: 'No autenticado. Inicia sesión para continuar.' });
  }

  if (!['admin', 'coordinador'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Acceso denegado. Solo administradores pueden realizar correcciones.' });
  }

  next();
}
