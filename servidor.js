// =============================================================
//  SERVIDOR DE i24h
//  Corre con: node servidor.js
//  Luego abre el navegador en: http://localhost:3000
// =============================================================

import express        from 'express';
import session        from 'express-session';
import helmet         from 'helmet';
import rateLimit      from 'express-rate-limit';
import mongoose       from 'mongoose';
import dotenv         from 'dotenv';
import fs             from 'fs';
import path           from 'path';
import { fileURLToPath } from 'url';
import { engine }     from 'express-handlebars';
import QRCode         from 'qrcode';
import Usuario        from './models/Usuario.js';

// Carga las variables del archivo .env (MONGO_URI, Puerto, etc.)
dotenv.config();

// En ES Modules, __dirname no existe — se obtiene así:
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// =============================================================
//  CONEXIÓN A MONGODB
// =============================================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✓ Conectado a MongoDB Atlas'))
  .catch(err => {
    console.error('✗ Error MongoDB:', err.message);
    console.error('  → El servidor sigue activo pero las funciones de cuenta no funcionarán hasta reconectar.');
  });

const app = express();

// Carpeta donde se guardan los datos (comentarios y usuarios)
const CARPETA_DATOS = path.join(__dirname, 'datos');

// =============================================================
//  MOTOR DE PLANTILLAS — Handlebars
//  Las vistas están en la carpeta "vistas/"
//  El layout principal es "vistas/layouts/main.hbs"
// =============================================================
app.engine('hbs', engine({
  extname:       '.hbs',
  layoutsDir:    path.join(__dirname, 'vistas/layouts'),
  defaultLayout: 'main',
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'vistas'));

// =============================================================
//  SEGURIDAD — helmet + rate limiting
// =============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      fontSrc:    ["'self'", 'https://cdn.jsdelivr.net'],
      imgSrc:     ["'self'", 'data:'],  // data: para los QR generados como dataURL
      connectSrc: ["'self'"],
    },
  },
}));

// Límite de 100 peticiones cada 15 min por IP en todas las rutas /api/
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intenta más tarde.' },
}));

// =============================================================
//  SESIONES — express-session
//  Guarda quién está logueado entre peticiones HTTP.
//  La cookie "i24h.sid" identifica al usuario en su navegador.
// =============================================================
app.use(session({
  name:   'i24h.sid',
  secret: process.env.SESSION_SECRET || 'i24h-secreto-local',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,   // La cookie no es accesible desde JS del navegador (más seguro)
    maxAge:   1000 * 60 * 60 * 8,  // 8 horas
  },
}));

// Le dice al servidor que entiende JSON y que sirve archivos estáticos (CSS, JS, imágenes)
app.use(express.json());
// index: false evita que Express sirva index.html para "/",
// dejando que la ruta GET / de Handlebars tome el control
app.use(express.static(__dirname, { index: false }));

// =============================================================
//  MIDDLEWARES DE AUTORIZACIÓN
// =============================================================

// Verifica que haya una sesión activa — devuelve 401 si no
function requireAuth(req, res, next) {
  if (!req.session.usuario) return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
  next();
}

// Verifica que el cargo sea admin o coordinador — devuelve 403 si no
function requireAdmin(req, res, next) {
  const cargo = req.session.usuario?.cargo;
  if (!['admin', 'coordinador'].includes(cargo))
    return res.status(403).json({ error: 'Acceso restringido al personal autorizado.' });
  next();
}

// Bloquea clientes y no autenticados del panel de empleados
function requireEmpleado(req, res, next) {
  const u = req.session.usuario;
  if (!u || u.cargo === 'cliente') return res.redirect('/');
  next();
}

// Catálogo de recompensas canjeables por puntos
const RECOMPENSAS = [
  { id: 'internet-30',  nombre: '30 min de internet gratis',      puntos: 50,  icono: 'ti-wifi' },
  { id: 'internet-60',  nombre: '1 hora de internet gratis',       puntos: 100, icono: 'ti-clock' },
  { id: 'impresion',    nombre: '10% descuento en impresiones',    puntos: 150, icono: 'ti-printer' },
  { id: 'refresco',     nombre: 'Refresco gratis en sucursal',     puntos: 200, icono: 'ti-bottle' },
  { id: 'internet-180', nombre: '3 horas de internet gratis',      puntos: 300, icono: 'ti-device-desktop' },
  { id: 'kit-papeleria',nombre: 'Kit de papelería gratis',         puntos: 500, icono: 'ti-notebook' },
];

// Sucursales con coordenadas para enlaces directos a Google Maps
const SUCURSALES = [
  { nombre: 'Sucursal Mitras',        dir: 'Av. Venustiano Carranza 1232, Mitras Centro',       lat: 25.6790, lng: -100.3735 },
  { nombre: 'Sucursal Santa Catarina', dir: 'Blvd. Díaz Ordaz 450, Santa Catarina',             lat: 25.6743, lng: -100.4593 },
  { nombre: 'Sucursal Cumbres',       dir: 'Av. Paseo de los Leones 2901, Cumbres 4to Sector',  lat: 25.7291, lng: -100.3891 },
];

// =============================================================
//  MIDDLEWARE: sesionActual
//  En cada petición pasa el usuario de la sesión a res.locals
//  para que Handlebars pueda usarlo en las vistas con {{usuario}}
// =============================================================
function sesionActual(req, res, next) {
  res.locals.usuario = req.session.usuario || null;
  next();
}

// =============================================================
//  RUTAS DE VISTAS (páginas renderizadas con Handlebars)
// =============================================================

// Panel de administración → renderiza vistas/panel.hbs
app.get('/panel', sesionActual, requireEmpleado, (req, res) => {
  const u = req.session.usuario;
  res.render('panel', {
    titulo:          'Panel i24h',
    scriptPrincipal: 'panel.js',
    usuario:         u,
    esAdmin:         ['admin', 'coordinador'].includes(u.cargo),
  });
});

// Página principal → renderiza vistas/index.hbs
// sesionActual inyecta res.locals.usuario para que Handlebars lo use con {{usuario}}
app.get('/', sesionActual, (req, res) => {
  const u = req.session.usuario || null;
  res.render('index', {
    titulo:          'Internet 24 Horas',
    scriptPrincipal: 'JAVA.js',
    anio:            new Date().getFullYear(),
    usuario:         u,
    logueado:        !!u,
    // Booleanos de rol — true si el cargo tiene ese nivel o superior
    esAdmin:       u?.cargo === 'admin',
    esCoordinador: ['admin','coordinador'].includes(u?.cargo),
    esLider:       ['admin','coordinador','lider'].includes(u?.cargo),
    esEncargado:   ['admin','coordinador','lider','encargado'].includes(u?.cargo),
    esEmpleado:    !!u && u.cargo !== 'cliente',
  });
});

// Devuelve el usuario de la sesión actual (o null si no hay sesión)
app.get('/api/sesion', (req, res) => {
  res.json(req.session.usuario || null);
});

// =============================================================
//  PANEL DEL CLIENTE — solo accesible con sesión de cargo cliente
// =============================================================
app.get('/cliente', sesionActual, async (req, res) => {
  const u = req.session.usuario;
  if (!u)                  return res.redirect('/');
  if (u.cargo !== 'cliente') return res.redirect(u.cargo !== 'cliente' ? '/panel' : '/');

  try {
    // Trae los datos completos del cliente desde MongoDB
    const usuario = await Usuario.findById(u.id);
    if (!usuario) return res.redirect('/');

    // Si por alguna razón no tiene qrId aún, lo genera y guarda
    if (!usuario.qrId) await usuario.save();

    // Genera la imagen QR como data URL para incrustarla directamente en el HTML
    const qrDataUrl = await QRCode.toDataURL(`i24h:${usuario.qrId}`, {
      width:  250,
      margin: 2,
      color: { dark: '#1e0a0a', light: '#ffffff' },
    });

    // Marca qué recompensas puede canjear según sus puntos actuales
    const recompensas = RECOMPENSAS.map(r => ({
      ...r,
      disponible: usuario.puntos >= r.puntos,
    }));

    // Historial ordenado del más reciente al más antiguo
    const historial = [...(usuario.historial || [])].reverse().slice(0, 10);

    // Sucursales con URL de Maps lista para usar
    const sucursales = SUCURSALES.map(s => ({
      ...s,
      mapsUrl: `https://maps.google.com/?q=${s.lat},${s.lng}`,
    }));

    res.render('cliente', {
      titulo:          'Mi cuenta — i24h',
      scriptPrincipal: 'JAVA.js',
      estiloExtra:     'cliente.css',
      anio:            new Date().getFullYear(),
      usuario: {
        id:      usuario._id.toString(),
        correo:  usuario.correo,
        nombre:  usuario.nombre,
        puntos:  usuario.puntos,
        qrId:    usuario.qrId,
        canjes:  usuario.canjes || [],
      },
      qrDataUrl,
      recompensas,
      historial,
      sucursales,
      hayHistorial: historial.length > 0,
      hayCanjes:    (usuario.canjes || []).length > 0,
    });
  } catch (err) {
    console.error('Error en /cliente:', err);
    res.redirect('/');
  }
});

// =============================================================
//  CANJE DE RECOMPENSAS
//  POST /api/canjear — descuenta puntos y registra el canje
// =============================================================
app.post('/api/canjear', requireAuth, async (req, res) => {
  const { recompensaId } = req.body;
  const u = req.session.usuario;
  if (u.cargo !== 'cliente') return res.status(403).json({ error: 'Solo clientes pueden canjear.' });

  const recompensa = RECOMPENSAS.find(r => r.id === recompensaId);
  if (!recompensa) return res.status(400).json({ error: 'Recompensa no válida.' });

  try {
    const usuario = await Usuario.findById(u.id);
    if (usuario.puntos < recompensa.puntos)
      return res.status(400).json({ error: 'No tienes suficientes puntos.' });

    usuario.puntos -= recompensa.puntos;
    usuario.canjes.push({
      recompensa:   recompensa.nombre,
      puntosUsados: recompensa.puntos,
    });
    await usuario.save();

    // Actualiza puntos en la sesión
    req.session.usuario.puntos = usuario.puntos;

    res.json({ ok: true, puntosRestantes: usuario.puntos, recompensa: recompensa.nombre });
  } catch {
    res.status(500).json({ error: 'Error al procesar el canje.' });
  }
});

// Destruye la sesión del servidor al cerrar sesión
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('i24h.sid');
    res.json({ ok: true });
  });
});

// =============================================================
//  FUNCIONES PARA LEER Y GUARDAR DATOS
// =============================================================

// Lee un archivo JSON y devuelve su contenido
function leer(archivo) {
  return JSON.parse(fs.readFileSync(path.join(CARPETA_DATOS, archivo), 'utf8'));
}

// Guarda datos en un archivo JSON
function guardar(archivo, datos) {
  fs.writeFileSync(path.join(CARPETA_DATOS, archivo), JSON.stringify(datos, null, 2));
}

// =============================================================
//  RUTAS DE COMENTARIOS
//  GET  /api/comentarios  → devuelve todos los comentarios
//  POST /api/comentarios  → guarda un comentario nuevo
// =============================================================

app.get('/api/comentarios', (req, res) => {
  const lista = leer('comentarios.json');
  res.json(lista.slice().reverse()); // Los más recientes primero
});

app.post('/api/comentarios', (req, res) => {
  const { texto, estrellas } = req.body;

  if (!texto || !estrellas)           return res.status(400).json({ error: 'Faltan datos' });
  if (estrellas < 1 || estrellas > 5) return res.status(400).json({ error: 'Estrellas inválidas' });

  const lista = leer('comentarios.json');
  const nuevo = {
    id: Date.now(),
    texto: texto.trim(),
    estrellas,
    fecha: new Date().toISOString()
  };
  lista.push(nuevo);
  guardar('comentarios.json', lista);
  res.json(nuevo);
});

// =============================================================
//  RUTAS DE USUARIOS (MongoDB + Mongoose)
//  POST /api/registro  → crea cuenta de cliente (requiere código)
//  POST /api/login     → verifica correo y contraseña
// =============================================================

app.post('/api/registro', async (req, res) => {
  const { correo, password, codigo } = req.body;

  if (!correo || !password || !codigo) return res.status(400).json({ error: 'Faltan datos' });
  if (password.length < 6)             return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  // Valida que el código exista y no haya sido usado (sigue en JSON por ahora)
  const codigos = leer('codigos.json');
  const entrada = codigos.find(c => c.codigo === codigo.trim().toUpperCase());
  if (!entrada)      return res.status(400).json({ error: 'Código de acceso inválido' });
  if (entrada.usado) return res.status(400).json({ error: 'Ese código ya fue utilizado' });

  try {
    // Crea el usuario en MongoDB — el modelo encripta la contraseña automáticamente
    const nuevo = await Usuario.create({
      correo:      correo.trim().toLowerCase(),
      password,
      cargo:       'cliente',
      codigoUsado: codigo.trim().toUpperCase(),
    });

    // Marca el código como usado
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

app.post('/api/login', async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) return res.status(400).json({ error: 'Faltan datos' });

  try {
    // Se usa .select('+password') porque el campo password tiene select:false en el modelo
    const usuario = await Usuario.findOne({ correo: correo.trim().toLowerCase() }).select('+password');

    if (!usuario) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    if (!usuario.activo) return res.status(403).json({ error: 'Esta cuenta fue desactivada' });

    // El método verificarPassword está definido en models/Usuario.js
    const passwordCorrecta = await usuario.verificarPassword(password);
    if (!passwordCorrecta) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });

    // Guarda el usuario en la sesión del servidor
    req.session.usuario = {
      id:     usuario._id,
      correo: usuario.correo,
      nombre: usuario.nombre,
      cargo:  usuario.cargo,
      puntos: usuario.puntos,
    };

    res.json(req.session.usuario);
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// =============================================================
//  RUTAS DE CÓDIGOS
//  GET  /api/codigos       → lista todos los códigos
//  POST /api/codigos       → genera un código nuevo
// =============================================================

app.get('/api/codigos', requireAuth, (req, res) => {
  const codigos = leer('codigos.json');
  res.json(codigos.slice().reverse());
});

app.post('/api/codigos', requireAuth, requireAdmin, (req, res) => {
  const { creadoPor } = req.body;

  // Genera un código aleatorio de 8 caracteres (sin letras confusas como O, I, 0, 1)
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += caracteres[Math.floor(Math.random() * caracteres.length)];
  }

  const codigos = leer('codigos.json');
  const nuevo = {
    id:        Date.now(),
    codigo,
    usado:     false,
    usadoPor:  null,
    fechaUso:  null,
    creadoPor: creadoPor || 'admin',
    fecha:     new Date().toISOString()
  };
  codigos.push(nuevo);
  guardar('codigos.json', codigos);
  res.json(nuevo);
});

// Elimina (revoca) un código que aún no fue usado
app.delete('/api/codigos/:id', requireAuth, requireAdmin, (req, res) => {
  const id      = parseInt(req.params.id);
  const codigos = leer('codigos.json');
  const idx     = codigos.findIndex(c => c.id === id);

  if (idx === -1)              return res.status(404).json({ error: 'Código no encontrado' });
  if (codigos[idx].usado)     return res.status(400).json({ error: 'No se puede eliminar un código ya usado' });

  codigos.splice(idx, 1);
  guardar('codigos.json', codigos);
  res.json({ ok: true });
});

// =============================================================
//  RUTAS DE EMPLEADOS (MongoDB)
//  GET  /api/empleados  → lista todos los empleados
//  POST /api/empleados  → crea cuenta de empleado
// =============================================================

app.get('/api/empleados', requireAuth, async (req, res) => {
  try {
    const empleados = await Usuario.find({ cargo: { $ne: 'cliente' } }).sort({ fechaCreacion: -1 });
    res.json(empleados);
  } catch {
    res.status(500).json({ error: 'Error al obtener empleados' });
  }
});

app.post('/api/empleados', requireAuth, requireAdmin, async (req, res) => {
  const { correo, password, nombre, cargo } = req.body;

  if (!correo || !password || !cargo) return res.status(400).json({ error: 'Faltan datos' });
  if (password.length < 6)           return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const cargosValidos = ['admin', 'coordinador', 'lider', 'encargado', 'colaborador'];
  if (!cargosValidos.includes(cargo)) return res.status(400).json({ error: 'Cargo inválido' });

  try {
    const nuevo = await Usuario.create({ correo, password, nombre, cargo });
    res.json({ id: nuevo._id, correo: nuevo.correo, nombre: nuevo.nombre, cargo: nuevo.cargo });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ese correo ya está registrado' });
    res.status(500).json({ error: 'Error al crear empleado' });
  }
});

// =============================================================
//  RUTAS DE CLIENTES (MongoDB)
//  GET /api/clientes  → lista todos los clientes registrados
// =============================================================

app.get('/api/clientes', requireAuth, async (req, res) => {
  try {
    const clientes = await Usuario.find({ cargo: 'cliente' }).sort({ fechaCreacion: -1 });
    res.json(clientes);
  } catch {
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// =============================================================
//  CAMBIAR ESTADO DE CUENTA (activar / desactivar) — MongoDB
//  PATCH /api/usuarios/:id/estado
// =============================================================

app.patch('/api/usuarios/:id/estado', requireAuth, requireAdmin, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    usuario.activo = !usuario.activo;
    await usuario.save();
    res.json({ id: usuario._id, activo: usuario.activo });
  } catch {
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// =============================================================
//  RESUMEN GENERAL (MongoDB)
//  GET /api/resumen  → contadores para las tarjetas del panel
// =============================================================

app.get('/api/resumen', requireAuth, async (req, res) => {
  try {
    const codigos     = leer('codigos.json');
    const comentarios = leer('comentarios.json');

    const [empleados, clientes] = await Promise.all([
      Usuario.countDocuments({ cargo: { $ne: 'cliente' }, activo: true }),
      Usuario.countDocuments({ cargo: 'cliente' }),
    ]);

    res.json({
      empleados,
      clientes,
      codigos:     codigos.filter(c => !c.usado).length,
      comentarios: comentarios.length,
    });
  } catch {
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
});

// =============================================================
//  ARRANCAR EL SERVIDOR
//  Puerto 3000 → http://localhost:3000
// =============================================================
const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log('✓ Servidor i24h corriendo en http://localhost:' + PUERTO);
  console.log('  Presiona Ctrl + C para detenerlo.');
});
