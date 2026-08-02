import { Router } from 'express';
import Usuario    from '../models/Usuario.js';
import { leer, guardar } from '../utils/data.js';
import { requireAuth }   from '../middlewares/auth.js';

const router = Router();

// GET /api/sesion — devuelve el usuario de la sesión activa (o null)
router.get('/sesion', (req, res) => {
  res.json(req.session.usuario || null);
});

// POST /api/login — verifica correo y contraseña, abre sesión
router.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const usuario = await Usuario.findOne({ correo: correo.trim().toLowerCase() }).select('+password');
    if (!usuario)        return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    if (!usuario.activo) return res.status(403).json({ error: 'Esta cuenta fue desactivada' });

    const ok = await usuario.verificarPassword(password);
    if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });

    Usuario.findByIdAndUpdate(usuario._id, { ultimaConexion: new Date() }).exec();

    req.session.usuario = {
      id:     usuario._id,
      correo: usuario.correo,
      nombre: usuario.nombre,
      cargo:  usuario.cargo,
      puntos: usuario.puntos,
      turno:  usuario.turno || null,
    };
    res.json(req.session.usuario);
  } catch {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// POST /api/logout — destruye la sesión
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('i24h.sid');
    res.json({ ok: true });
  });
});

// POST /api/registro — crea cuenta de cliente (requiere código de acceso)
router.post('/registro', async (req, res) => {
  const { correo, password, codigo } = req.body;
  if (!correo || !password || !codigo) return res.status(400).json({ error: 'Faltan datos' });
  if (password.length < 6)             return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const codigos = leer('codigos.json');
  const entrada = codigos.find(c => c.codigo === codigo.trim().toUpperCase());
  if (!entrada)      return res.status(400).json({ error: 'Código de acceso inválido' });
  if (entrada.usado) return res.status(400).json({ error: 'Ese código ya fue utilizado' });

  try {
    const nuevo = await Usuario.create({
      correo:      correo.trim().toLowerCase(),
      password,
      cargo:       'cliente',
      codigoUsado: codigo.trim().toUpperCase(),
    });
    entrada.usado    = true;
    entrada.usadoPor = nuevo.correo;
    entrada.fechaUso = new Date().toISOString();
    guardar('codigos.json', codigos);
    res.json({ id: nuevo._id, correo: nuevo.correo, puntos: nuevo.puntos });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ese correo ya está registrado' });
    res.status(500).json({ error: 'Error al crear la cuenta' });
  }
});

export default router;
