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
import Empleado       from './models/Empleado.js';
import Auditoria      from './models/Auditoria.js';

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

    // Registra la última conexión (sin esperar para no ralentizar el login)
    Usuario.findByIdAndUpdate(usuario._id, { ultimaConexion: new Date() }).exec();

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
  const { correo, password, nombre, cargo, sucursales } = req.body;

  if (!correo || !password || !cargo) return res.status(400).json({ error: 'Faltan datos' });
  if (password.length < 6)           return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const cargosValidos = ['admin', 'coordinador', 'lider', 'encargado', 'colaborador'];
  if (!cargosValidos.includes(cargo)) return res.status(400).json({ error: 'Cargo inválido' });

  const sucursalesLimpias = Array.isArray(sucursales) ? sucursales : [];

  try {
    const nuevo = await Usuario.create({ correo, password, nombre, cargo, sucursales: sucursalesLimpias });
    res.json({ id: nuevo._id, correo: nuevo.correo, nombre: nuevo.nombre, cargo: nuevo.cargo, sucursales: nuevo.sucursales });
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
//  ELIMINAR CUENTA — DELETE /api/usuarios/:id
// =============================================================

app.delete('/api/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const sesiónActual = req.session.usuario;
    if (String(usuario._id) === String(sesiónActual?.id))
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

    await Usuario.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// =============================================================
//  EDITAR EMPLEADO — cargo, sucursales, contraseña
// =============================================================

app.patch('/api/empleados/:id/cargo', requireAuth, requireAdmin, async (req, res) => {
  const { cargo } = req.body;
  const validos = ['admin', 'coordinador', 'lider', 'encargado', 'colaborador'];
  if (!validos.includes(cargo)) return res.status(400).json({ error: 'Cargo inválido' });
  try {
    const emp = await Usuario.findByIdAndUpdate(req.params.id, { cargo }, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ id: emp._id, cargo: emp.cargo });
  } catch { res.status(500).json({ error: 'Error al actualizar cargo' }); }
});

app.patch('/api/empleados/:id/sucursales', requireAuth, requireAdmin, async (req, res) => {
  const { sucursales } = req.body;
  if (!Array.isArray(sucursales)) return res.status(400).json({ error: 'Formato inválido' });
  try {
    const emp = await Usuario.findByIdAndUpdate(req.params.id, { sucursales }, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ id: emp._id, sucursales: emp.sucursales });
  } catch { res.status(500).json({ error: 'Error al actualizar sucursales' }); }
});

app.patch('/api/empleados/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  try {
    const hash = await import('bcryptjs').then(m => m.default.hash(password, 10));
    const emp  = await Usuario.findByIdAndUpdate(req.params.id, { password: hash }, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al cambiar contraseña' }); }
});

// =============================================================
//  CLIENTES — ajustar puntos, obtener canjes
// =============================================================

app.patch('/api/clientes/:id/puntos', requireAuth, requireAdmin, async (req, res) => {
  const { ajuste, motivo } = req.body;
  if (typeof ajuste !== 'number') return res.status(400).json({ error: 'Ajuste inválido' });
  if (!motivo?.trim())            return res.status(400).json({ error: 'El motivo es obligatorio' });
  try {
    const cli = await Usuario.findById(req.params.id);
    if (!cli || cli.cargo !== 'cliente') return res.status(404).json({ error: 'Cliente no encontrado' });
    cli.puntos = Math.max(0, (cli.puntos || 0) + ajuste);
    await cli.save();
    res.json({ id: cli._id, puntos: cli.puntos });
  } catch { res.status(500).json({ error: 'Error al ajustar puntos' }); }
});

app.get('/api/clientes/:id/canjes', requireAuth, async (req, res) => {
  try {
    const cli = await Usuario.findById(req.params.id);
    if (!cli || cli.cargo !== 'cliente') return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ canjes: cli.canjes || [] });
  } catch { res.status(500).json({ error: 'Error al obtener canjes' }); }
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
//  VENTAS — datos mock listos para swappear por queries a PG
//  Convención de tabla real: ventas_DD_MM_YYYY_sucursal
// =============================================================

const VNT_SUCURSALES = [
  { id: 'simon-bolivar', nombre: 'Simón Bolívar' },
  { id: 'insurgentes',   nombre: 'Insurgentes'   },
  { id: 'antigona',      nombre: 'Antígona'       },
  { id: 'lincoln-oxxo',  nombre: 'Lincoln Oxxo'  },
  { id: 'lincoln-2',     nombre: 'Lincoln 2'      },
  { id: 'ruiz-cortines', nombre: 'Ruiz Cortines' },
  { id: 'rodas',         nombre: 'Rodas'          },
  { id: 'cuauhtemoc',    nombre: 'Cuauhtémoc'    },
  { id: 'ordonez',       nombre: 'Ordóñez'        },
];

// Ventas base diarias por sucursal y categoría — sin Limpieza
const VNT_BASE = {
  'simon-bolivar': { Novedades: 8400,  Papelería: 12300, Snack: 3200 },
  'insurgentes':   { Novedades: 6100,  Papelería: 9800,  Snack: 2400 },
  'antigona':      { Novedades: 5700,  Papelería: 8600,  Snack: 1900 },
  'lincoln-oxxo':  { Novedades: 4300,  Papelería: 7200,  Snack: 1600 },
  'lincoln-2':     { Novedades: 3900,  Papelería: 6500,  Snack: 1400 },
  'ruiz-cortines': { Novedades: 5200,  Papelería: 8100,  Snack: 2100 },
  'rodas':         { Novedades: 4800,  Papelería: 7500,  Snack: 1750 },
  'cuauhtemoc':    { Novedades: 4100,  Papelería: 6800,  Snack: 1550 },
  'ordonez':       { Novedades: 3600,  Papelería: 5900,  Snack: 1300 },
};

// Variación vs período anterior — determinista, sin Math.random
const VNT_DELTA = {
  'simon-bolivar':  4.2,
  'insurgentes':   -1.8,
  'antigona':       7.5,
  'lincoln-oxxo':  -3.1,
  'lincoln-2':      2.9,
  'ruiz-cortines':  5.4,
  'rodas':         -0.6,
  'cuauhtemoc':     8.1,
  'ordonez':       -2.4,
};

const VNT_MULT = { hoy: 1, '7': 7, '15': 15, '30': 30 };

// GET /api/ventas?sucursal=&periodo=
// Devuelve ventas agrupadas por sucursal y categoría (sin Limpieza)
app.get('/api/ventas', requireAuth, (req, res) => {
  const { sucursal = 'todas', periodo = '7' } = req.query;
  const mult = VNT_MULT[periodo] || 7;
  const cats = ['Novedades', 'Papelería', 'Snack'];

  const sucsFiltradas = sucursal === 'todas'
    ? VNT_SUCURSALES
    : VNT_SUCURSALES.filter(s => s.id === sucursal);

  const desglose = sucsFiltradas.map(s => {
    const base = VNT_BASE[s.id] || {};
    const categorias = {};
    let totalSuc = 0;
    cats.forEach(cat => {
      const val = Math.round((base[cat] || 0) * mult);
      categorias[cat] = val;
      totalSuc += val;
    });
    return { id: s.id, nombre: s.nombre, total: totalSuc, categorias, delta: VNT_DELTA[s.id] || 0 };
  });

  const totalGeneral   = desglose.reduce((a, s) => a + s.total, 0);
  const topSucursal    = [...desglose].sort((a, b) => b.total - a.total)[0];
  const deltaPromedio  = Math.round(
    desglose.reduce((a, s) => a + s.delta, 0) / (desglose.length || 1) * 10
  ) / 10;

  const porCategoria = {};
  cats.forEach(cat => {
    porCategoria[cat] = desglose.reduce((a, s) => a + (s.categorias[cat] || 0), 0);
  });
  const topCategoria = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0];

  res.json({
    periodo,
    sucursal,
    totalGeneral,
    topSucursal:  topSucursal  ? { id: topSucursal.id, nombre: topSucursal.nombre, total: topSucursal.total } : null,
    topCategoria: topCategoria ? { nombre: topCategoria[0], total: topCategoria[1] } : null,
    deltaPromedio,
    desglose,
    porCategoria,
  });
});

// GET /api/ventas/top-productos?categoria=&periodo=
// Devuelve los N productos más vendidos — sin categoría Limpieza
app.get('/api/ventas/top-productos', requireAuth, (req, res) => {
  const { categoria = 'todas', periodo = '7' } = req.query;
  const mult = VNT_MULT[periodo] || 7;

  const PRODUCTOS_MOCK = [
    { nombre: 'Hoja doble carta',       categoria: 'Papelería', sucursal: 'Simón Bolívar', unidades: 320, precio: 2.5  },
    { nombre: 'Tabloide couche suelto', categoria: 'Papelería', sucursal: 'Insurgentes',   unidades: 280, precio: 4.0  },
    { nombre: 'Novedad rojo $20',       categoria: 'Novedades', sucursal: 'Antígona',       unidades: 215, precio: 20   },
    { nombre: 'Hoja opalina',           categoria: 'Papelería', sucursal: 'Ruiz Cortines',  unidades: 190, precio: 3.5  },
    { nombre: 'Pasta transparente',     categoria: 'Papelería', sucursal: 'Simón Bolívar',  unidades: 175, precio: 5.0  },
    { nombre: 'Novedad azul $30',       categoria: 'Novedades', sucursal: 'Cuauhtémoc',     unidades: 160, precio: 30   },
    { nombre: 'Sabritas varios',        categoria: 'Snack',     sucursal: 'Lincoln Oxxo',   unidades: 155, precio: 15   },
    { nombre: 'Galleta varios',         categoria: 'Snack',     sucursal: 'Rodas',           unidades: 142, precio: 12   },
    { nombre: 'Legajo carta',           categoria: 'Papelería', sucursal: 'Lincoln 2',       unidades: 138, precio: 6.0  },
    { nombre: 'Coca Cola',             categoria: 'Snack',     sucursal: 'Ordóñez',         unidades: 130, precio: 18   },
    { nombre: 'Novedad verde $40',      categoria: 'Novedades', sucursal: 'Insurgentes',     unidades: 125, precio: 40   },
    { nombre: 'Pluma negra',            categoria: 'Papelería', sucursal: 'Antígona',        unidades: 118, precio: 3.0  },
    { nombre: 'Agua 500ml',             categoria: 'Snack',     sucursal: 'Simón Bolívar',   unidades: 115, precio: 10   },
    { nombre: 'Llavero Funko',          categoria: 'Novedades', sucursal: 'Ruiz Cortines',   unidades:  98, precio: 50   },
    { nombre: 'Enmicado carta',         categoria: 'Papelería', sucursal: 'Cuauhtémoc',      unidades:  90, precio: 12   },
  ];

  let lista = categoria === 'todas' ? PRODUCTOS_MOCK : PRODUCTOS_MOCK.filter(p => p.categoria === categoria);

  const resultado = lista.slice(0, 10).map(p => ({
    nombre:    p.nombre,
    categoria: p.categoria,
    sucursal:  p.sucursal,
    unidades:  Math.round(p.unidades * mult / 7),
    venta:     Math.round(p.unidades * mult / 7 * p.precio),
  }));

  res.json(resultado);
});

// GET /api/ventas/alertas
// Cruce ventas + inventario: riesgo de quiebre y mercancía estancada
app.get('/api/ventas/alertas', requireAuth, (req, res) => {
  res.json([
    { tipo: 'quiebre',  producto: 'Novedad rojo $20',   sucursal: 'Antígona',      stock:  3, vendidos7: 215, mensaje: 'Alto movimiento con stock crítico' },
    { tipo: 'quiebre',  producto: 'Sabritas varios',     sucursal: 'Lincoln Oxxo',  stock:  5, vendidos7: 155, mensaje: 'Alto movimiento con stock crítico' },
    { tipo: 'quiebre',  producto: 'Agua 500ml',          sucursal: 'Simón Bolívar', stock:  8, vendidos7: 115, mensaje: 'Alto movimiento con stock bajo'    },
    { tipo: 'estancada',producto: 'Novedad negra $350',  sucursal: 'Insurgentes',   stock: 12, vendidos7:   0, mensaje: 'Sin ventas en 7 días'              },
    { tipo: 'estancada',producto: 'Memoria USB 32gb',    sucursal: 'Cuauhtémoc',    stock:  9, vendidos7:   1, mensaje: 'Stock alto, baja rotación'         },
    { tipo: 'estancada',producto: 'Llavero Funko',       sucursal: 'Ordóñez',       stock: 14, vendidos7:   2, mensaje: 'Stock alto, baja rotación'         },
  ]);
});

// =============================================================
//  STAFF (empleados de desempeño) — colección separada de los usuarios auth
//  Rutas bajo /api/staff para no pisar las rutas de /api/empleados (auth)
// =============================================================

const SUCURSALES_STAFF = ['Simon Bolivar', 'Centro', 'Sureste'];

// GET /api/staff?sucursal=&orden=puntaje|ventas|turnos
app.get('/api/staff', requireAuth, async (req, res) => {
  const { sucursal, orden = 'puntaje' } = req.query;
  const filtro = { activo: true };
  if (sucursal && SUCURSALES_STAFF.includes(sucursal)) filtro.sucursal = sucursal;

  try {
    let lista = await Empleado.find(filtro)
      .populate('lider_id', 'nombre')
      .populate('coordinador_id', 'nombre')
      .lean();

    if (orden === 'ventas')  lista.sort((a, b) => b.ventas_extraordinarias - a.ventas_extraordinarias);
    else if (orden === 'turnos') lista.sort((a, b) => (b.turnos?.length || 0) - (a.turnos?.length || 0));
    else lista.sort((a, b) => b.puntos_acumulados - a.puntos_acumulados);

    res.json(lista);
  } catch {
    res.status(500).json({ error: 'Error al obtener staff' });
  }
});

// GET /api/staff/:id/historial
app.get('/api/staff/:id/historial', requireAuth, async (req, res) => {
  try {
    const hist = await Auditoria.find({ empleado_id: req.params.id })
      .sort({ fecha: -1 })
      .limit(30)
      .lean();
    const conPromedio = hist.map(a => {
      const s = a.ventas + a.actitud + a.cumplimiento + a.asistencia
              + a.limpieza + a.atencion_cliente + a.eficiencia;
      return { ...a, promedio: parseFloat((s / 7).toFixed(2)) };
    });
    res.json(conPromedio);
  } catch {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// POST /api/staff — crear empleado de staff
app.post('/api/staff', requireAuth, requireAdmin, async (req, res) => {
  const { nombre, sucursal, lider_id, coordinador_id, rol, turnos } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  if (sucursal && !SUCURSALES_STAFF.includes(sucursal))
    return res.status(400).json({ error: 'Sucursal inválida' });
  try {
    const emp = await Empleado.create({ nombre: nombre.trim(), sucursal, lider_id, coordinador_id, rol, turnos });
    res.json(emp);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear empleado' });
  }
});

// PATCH /api/staff/:id — editar sucursal, lider, turnos, nivel_bono, etc.
app.patch('/api/staff/:id', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['sucursal', 'lider_id', 'coordinador_id', 'rol', 'turnos',
                  'puntos_acumulados', 'ventas_extraordinarias', 'nivel_bono', 'activo'];
  const update = {};
  for (const c of campos) if (req.body[c] !== undefined) update[c] = req.body[c];

  if (update.sucursal && !SUCURSALES_STAFF.includes(update.sucursal))
    return res.status(400).json({ error: 'Sucursal inválida' });

  try {
    const emp = await Empleado.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(emp);
  } catch {
    res.status(500).json({ error: 'Error al actualizar empleado' });
  }
});

// GET /api/auditorias/hoy?sucursal=
// Devuelve todos los empleados activos con bandera auditado:true/false del día actual
app.get('/api/auditorias/hoy', requireAuth, async (req, res) => {
  const { sucursal } = req.query;
  const filtro = { activo: true };
  if (sucursal && SUCURSALES_STAFF.includes(sucursal)) filtro.sucursal = sucursal;

  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const mañana = new Date(hoy); mañana.setDate(mañana.getDate() + 1);

    const [empleados, audHoy] = await Promise.all([
      Empleado.find(filtro).lean(),
      Auditoria.find({ fecha: { $gte: hoy, $lt: mañana } }).lean(),
    ]);

    const auditadosSet = new Set(audHoy.map(a => String(a.empleado_id)));
    const resultado = empleados.map(e => ({
      ...e,
      auditado_hoy: auditadosSet.has(String(e._id)),
      auditoria_hoy: audHoy.find(a => String(a.empleado_id) === String(e._id)) || null,
    }));

    // Calcular promedio en auditoria_hoy
    resultado.forEach(e => {
      if (e.auditoria_hoy) {
        const a = e.auditoria_hoy;
        const s = a.ventas + a.actitud + a.cumplimiento + a.asistencia
                + a.limpieza + a.atencion_cliente + a.eficiencia;
        e.auditoria_hoy.promedio = parseFloat((s / 7).toFixed(2));
      }
    });

    res.json(resultado);
  } catch {
    res.status(500).json({ error: 'Error al obtener auditorías de hoy' });
  }
});

// POST /api/auditorias — registrar auditoría diaria
app.post('/api/auditorias', requireAuth, async (req, res) => {
  const RUBROS = ['ventas', 'actitud', 'cumplimiento', 'asistencia', 'limpieza', 'atencion_cliente', 'eficiencia'];
  const { empleado_id, lider_auditor_id, fecha, ...rubros } = req.body;

  if (!empleado_id) return res.status(400).json({ error: 'empleado_id requerido' });
  for (const r of RUBROS) {
    const v = Number(rubros[r]);
    if (!rubros[r] || v < 1 || v > 10) return res.status(400).json({ error: `Rubro inválido: ${r}` });
  }

  try {
    // Evitar duplicado del mismo día
    const dia = fecha ? new Date(fecha) : new Date();
    dia.setHours(0, 0, 0, 0);
    const siguiente = new Date(dia); siguiente.setDate(siguiente.getDate() + 1);
    const existente = await Auditoria.findOne({ empleado_id, fecha: { $gte: dia, $lt: siguiente } });
    if (existente) return res.status(409).json({ error: 'Este empleado ya tiene auditoría hoy' });

    const s = RUBROS.reduce((acc, r) => acc + Number(rubros[r]), 0);
    const promedio = parseFloat((s / 7).toFixed(2));
    // Puntos: 10 × promedio, redondeado
    const puntos_otorgados = Math.round(promedio * 10);

    const aud = await Auditoria.create({
      empleado_id, lider_auditor_id: lider_auditor_id || null,
      fecha: fecha ? new Date(fecha) : new Date(),
      ...Object.fromEntries(RUBROS.map(r => [r, Number(rubros[r])])),
      puntos_otorgados,
    });

    // Actualizar puntos acumulados del empleado
    await Empleado.findByIdAndUpdate(empleado_id, { $inc: { puntos_acumulados: puntos_otorgados } });

    res.json({ ...aud.toJSON(), promedio });
  } catch {
    res.status(500).json({ error: 'Error al registrar auditoría' });
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
