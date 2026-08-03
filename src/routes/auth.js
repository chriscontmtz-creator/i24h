import { Router } from 'express';
import bcrypt      from 'bcryptjs';
import rateLimit   from 'express-rate-limit';
import Usuario    from '../models/Usuario.js';
import { leer, guardar } from '../utils/data.js';
import { requireAuth }   from '../middlewares/auth.js';

const router = Router();

// Hash bcrypt "de relleno" — no corresponde a ninguna contraseña real.
// Se usa solo para que un correo inexistente tarde lo mismo en responder
// que uno que sí existe (ver comentario en /login más abajo).
const HASH_RELLENO = '$2a$10$ObMUmE.femOUHMB7cDMqE.Wci61M6Yuf7GuiG1ID/JqjKW9vnd94q';

// Límite específico para login — más estricto que el general de /api/
// (100 cada 15 min) para frenar intentos de fuerza bruta por credenciales.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Demasiados intentos de inicio de sesión. Espera unos minutos.' },
});

// GET /api/sesion — devuelve el usuario de la sesión activa (o null)
router.get('/sesion', (req, res) => {
  res.json(req.session.usuario || null);
});

// POST /api/login — verifica correo y contraseña, abre sesión
router.post('/login', loginLimiter, async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const usuario = await Usuario.findOne({ correo: correo.trim().toLowerCase() }).select('+password');

    if (!usuario) {
      // Compara contra un hash de relleno para que la respuesta tarde lo
      // mismo que con un correo que sí existe — si no, alguien podría
      // adivinar qué correos están registrados solo midiendo el tiempo
      // de respuesta (más rápido = no existe, más lento = sí existe).
      await bcrypt.compare(password, HASH_RELLENO);
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    if (!usuario.activo) return res.status(403).json({ error: 'Esta cuenta fue desactivada' });

    const ok = await usuario.verificarPassword(password);
    if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });

    Usuario.findByIdAndUpdate(usuario._id, { ultimaConexion: new Date() }).exec();

    const datosSesion = {
      id:     usuario._id,
      correo: usuario.correo,
      nombre: usuario.nombre,
      cargo:  usuario.cargo,
      puntos: usuario.puntos,
      turno:  usuario.turno || null,
    };

    // Regenera el ID de sesión al autenticar (no solo reusa la sesión anónima
    // que ya traía el navegador) — evita "session fixation": sin esto, alguien
    // que le hiciera llegar a la víctima una cookie de sesión ya conocida
    // podría terminar con una sesión válida en cuanto la víctima inicia sesión.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Error al iniciar sesión' });
      req.session.usuario = datosSesion;
      res.json(req.session.usuario);
    });
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

    const datosSesion = {
      id:     nuevo._id,
      correo: nuevo.correo,
      nombre: nuevo.nombre,
      cargo:  nuevo.cargo,
      puntos: nuevo.puntos,
      turno:  null,
    };

    // Deja al cliente con sesión abierta de inmediato, igual que /api/login
    // (mismo motivo para regenerar: evitar session fixation)
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Error al crear la cuenta' });
      req.session.usuario = datosSesion;
      res.json(req.session.usuario);
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ese correo ya está registrado' });
    res.status(500).json({ error: 'Error al crear la cuenta' });
  }
});

export default router;
