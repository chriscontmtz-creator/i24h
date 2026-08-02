// =============================================================
//  SERVIDOR DE i24h  —  punto de entrada principal
//  Corre con: node servidor.js
//  Luego abre el navegador en: http://localhost:3000
// =============================================================

import 'dotenv/config';
import express   from 'express';
import session   from 'express-session';
import helmet    from 'helmet';
import rateLimit from 'express-rate-limit';
import path      from 'path';
import { fileURLToPath } from 'url';
import { engine } from 'express-handlebars';

import conectarDB      from './src/config/db.js';
import authRoutes      from './src/routes/auth.js';
import vistasRoutes    from './src/routes/vistas.js';
import empleadosRoutes from './src/routes/empleados.js';
import clientesRoutes  from './src/routes/clientes.js';
import usuariosRoutes  from './src/routes/usuarios.js';
import codigosRoutes   from './src/routes/codigos.js';
import comentariosRoutes from './src/routes/comentarios.js';
import ventasRoutes         from './src/routes/ventas.js';
import ventasRegistrosRoutes from './src/routes/ventasRegistros.js';
import resumenRoutes         from './src/routes/resumen.js';
import horariosRoutes   from './src/routes/horarios.js';
import reportesRoutes   from './src/routes/reportes.js';
import dashboardRoutes  from './src/routes/dashboard.js';
import revisionesRoutes from './src/routes/revisiones.js';
import bitacorasRoutes  from './src/routes/bitacoras.js';
import ticketsRoutes    from './src/routes/tickets.js';
import inventarioRoutes from './src/routes/inventario.js';
import { iniciarCronCortes } from './src/utils/cronCortes.js';

// En ES Modules, __dirname no existe — se obtiene así:
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// =============================================================
//  BASE DE DATOS
// =============================================================
conectarDB();
iniciarCronCortes();

const app = express();

// =============================================================
//  MOTOR DE PLANTILLAS — Handlebars  (vistas en src/views/)
// =============================================================
app.engine('hbs', engine({
  extname:       '.hbs',
  layoutsDir:    path.join(__dirname, 'src/views/layouts'),
  defaultLayout: 'main',
  helpers: {
    eq: (a, b) => a === b,
  },
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'src/views'));

// =============================================================
//  SEGURIDAD — helmet + rate limiting
// =============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      // Helmet 7+ agrega script-src-attr 'none' por defecto — lo sobreescribimos
      // para permitir onclick/onchange inline que usa el panel
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      fontSrc:       ["'self'", 'https://cdn.jsdelivr.net'],
      imgSrc:        ["'self'", 'data:', 'https://api.qrserver.com'],
      // cdn.jsdelivr.net necesario para que DevTools no bloquee los .map de íconos
      connectSrc:    ["'self'", 'https://cdn.jsdelivr.net'],
    },
  },
}));

// 100 peticiones cada 15 min por IP en todas las rutas /api/
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Demasiadas peticiones. Intenta más tarde.' },
}));

// =============================================================
//  SESIONES
// =============================================================
app.use(session({
  name:   'i24h.sid',
  secret: process.env.SESSION_SECRET || 'i24h-secreto-local',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge:   1000 * 60 * 60 * 8,  // 8 horas
  },
}));

// =============================================================
//  PARSERS Y ARCHIVOS ESTÁTICOS
//  express.static sirve CSS/JS del cliente desde la raíz del proyecto
// =============================================================
app.use(express.json());
app.use(express.static(__dirname, { index: false }));

// =============================================================
//  RUTAS
// =============================================================
app.use('/',    vistasRoutes);       // GET /  /panel  /cliente
app.use('/api', authRoutes);         // login, logout, registro, sesion
app.use('/api', empleadosRoutes);    // empleados, staff, auditorias
app.use('/api', clientesRoutes);     // clientes, puntos, canjes, canjear
app.use('/api', usuariosRoutes);     // estado, delete
app.use('/api', codigosRoutes);      // codigos
app.use('/api', comentariosRoutes);  // comentarios
app.use('/api', ventasRoutes);              // ventas (mock JSON)
app.use('/api', ventasRegistrosRoutes);    // registros diarios reales (MongoDB)
app.use('/api', resumenRoutes);            // resumen
app.use('/horarios',   horariosRoutes);  // horarios (módulo propio)
app.use('/api',        reportesRoutes);  // reportes de departamento
app.use('/dashboard',  dashboardRoutes); // dashboard analítico
app.use('/revisiones', revisionesRoutes); // módulo de revisiones/contadores
app.use('/api',        bitacorasRoutes);  // bitácoras de turno
app.use('/api',        ticketsRoutes);   // tickets del sync (CyberPlanet)
app.use('/api',        inventarioRoutes); // inventario — descarga de Excel

// =============================================================
//  ARRANCAR
// =============================================================
const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
  console.log(`✓ Servidor i24h corriendo en http://localhost:${PUERTO}`);
  console.log('  Presiona Ctrl + C para detenerlo.');
});
