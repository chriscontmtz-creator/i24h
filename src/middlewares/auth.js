// Verifica que haya una sesión activa — devuelve 401 si no
export function requireAuth(req, res, next) {
  if (!req.session.usuario) return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
  next();
}

// Verifica que el cargo sea admin o coordinador — devuelve 403 si no
export function requireAdmin(req, res, next) {
  const cargo = req.session.usuario?.cargo;
  if (!['admin', 'coordinador'].includes(cargo))
    return res.status(403).json({ error: 'Acceso restringido al personal autorizado.' });
  next();
}

// Bloquea clientes y no autenticados del panel de empleados
export function requireEmpleado(req, res, next) {
  const u = req.session.usuario;
  if (!u || u.cargo === 'cliente') return res.redirect('/');
  next();
}

// Pasa el usuario de la sesión a res.locals para que Handlebars lo use con {{usuario}}
export function sesionActual(req, res, next) {
  res.locals.usuario = req.session.usuario || null;
  next();
}
