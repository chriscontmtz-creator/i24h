// =============================================================
//  SERVIDOR DE i24h
//  Corre con: node servidor.js
//  Luego abre el navegador en: http://localhost:3000
// =============================================================

import express    from 'express';
import mongoose   from 'mongoose';
import dotenv     from 'dotenv';
import fs         from 'fs';
import path       from 'path';
import { fileURLToPath } from 'url';
import { engine } from 'express-handlebars';
import Usuario    from './models/Usuario.js';

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
  .catch(err => { console.error('✗ Error al conectar a MongoDB:', err.message); process.exit(1); });

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

// Le dice al servidor que entiende JSON y que sirve archivos estáticos (CSS, JS, imágenes)
app.use(express.json());
app.use(express.static(__dirname));

// =============================================================
//  RUTAS DE VISTAS (páginas renderizadas con Handlebars)
// =============================================================

// Página principal → renderiza vistas/index.hbs dentro de vistas/layouts/main.hbs
app.get('/', (req, res) => {
  res.render('index', {
    titulo:          'Internet 24 Horas',
    scriptPrincipal: 'JAVA.js',
    anio:            new Date().getFullYear(),
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

    res.json({
      id:     usuario._id,
      correo: usuario.correo,
      nombre: usuario.nombre,
      cargo:  usuario.cargo,
      puntos: usuario.puntos,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// =============================================================
//  RUTAS DE CÓDIGOS
//  GET  /api/codigos       → lista todos los códigos
//  POST /api/codigos       → genera un código nuevo
// =============================================================

app.get('/api/codigos', (req, res) => {
  const codigos = leer('codigos.json');
  res.json(codigos.slice().reverse());
});

app.post('/api/codigos', (req, res) => {
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
app.delete('/api/codigos/:id', (req, res) => {
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

app.get('/api/empleados', async (req, res) => {
  try {
    const empleados = await Usuario.find({ cargo: { $ne: 'cliente' } }).sort({ fechaCreacion: -1 });
    res.json(empleados);
  } catch {
    res.status(500).json({ error: 'Error al obtener empleados' });
  }
});

app.post('/api/empleados', async (req, res) => {
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

app.get('/api/clientes', async (req, res) => {
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

app.patch('/api/usuarios/:id/estado', async (req, res) => {
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

app.get('/api/resumen', async (req, res) => {
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
