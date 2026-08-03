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
import mongoSanitize from 'express-mongo-sanitize';

import conectarDB      from './src/config/db.js';
import authRoutes      from './src/routes/auth.js';
import vistasRoutes    from './src/routes/vistas.js';
import empleadosRoutes from './src/routes/empleados.js';
import clientesRoutes  from './src/routes/clientes.js';
import usuariosRoutes  from './src/routes/usuarios.js';
import codigosRoutes   from './src/routes/codigos.js';
import comentariosRoutes from './src/routes/comentarios.js';
import ventasRoutes         from './src/routes/ventas.js';
import materialRoutes       from './src/routes/material.js';
import resumenRoutes         from './src/routes/resumen.js';
import horariosRoutes   from './src/routes/horarios.js';
import asistenciaRoutes from './src/routes/asistencia.js';
import reportesRoutes   from './src/routes/reportes.js';
import dashboardRoutes  from './src/routes/dashboard.js';
import revisionesRoutes from './src/routes/revisiones.js';
import bitacorasRoutes  from './src/routes/bitacoras.js';
import ticketsRoutes    from './src/routes/tickets.js';
import inventarioRoutes from './src/routes/inventario.js';
import promocionesRoutes from './src/routes/promociones.js';
import fotosRoutes       from './src/routes/fotos.js';
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

// Render (como Heroku) pone un proxy/load balancer enfrente que termina el
// TLS y reenvía por HTTP interno agregando X-Forwarded-*. Sin esto, Express
// no confía en esos headers: express-rate-limit no puede identificar la IP
// real del cliente (confirmado en logs: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)
// y req.secure/req.protocol quedan mal detectados detrás del proxy.
app.set('trust proxy', 1);

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
const esProduccion = process.env.NODE_ENV === 'production';

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
      // Solo forzar HTTPS en producción. En LAN/local (http://192.168.x.x)
      // esto rompe CSS/JS/imágenes: el navegador intenta bajarlos por https
      // y falla en silencio porque este servidor no habla HTTPS ahí.
      upgradeInsecureRequests: esProduccion ? [] : null,
    },
  },
  // Mismo motivo: HSTS le dice al navegador "nunca más uses http con este
  // host", lo cual rompería el acceso local/LAN por http permanentemente.
  hsts: esProduccion,
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
//  SESSION_SECRET es obligatorio — un secreto por defecto conocido
//  permitiría forjar cookies de sesión válidas.
// =============================================================
if (!process.env.SESSION_SECRET) {
  console.error('✗ ERROR: falta SESSION_SECRET en .env');
  console.error('  Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('  y agrégalo a .env como SESSION_SECRET=...');
  process.exit(1);
}

app.use(session({
  name:   'i24h.sid',
  secret: process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   1000 * 60 * 60 * 8,  // 8 horas
  },
}));

// =============================================================
//  PARSERS Y ARCHIVOS ESTÁTICOS
//  Solo se sirve public/ — NUNCA __dirname completo, porque eso
//  expondría código fuente, .env, datos/ y src/ por HTTP.
// =============================================================
app.use(express.json());

// Quita cualquier clave que empiece con '$' o contenga '.' de
// req.body/req.query/req.params — bloquea inyección de operadores
// Mongo (ej. ?sucursal[$ne]=1) en cualquier ruta, presente o futura.
app.use(mongoSanitize());

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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
app.use('/api', materialRoutes);           // venta sin material y sin tickets (error de impresión)
app.use('/api', resumenRoutes);            // resumen
app.use('/horarios',   horariosRoutes);  // horarios (módulo propio)
app.use('/asistencia', asistenciaRoutes); // checador QR + horas trabajadas
app.use('/api',        reportesRoutes);  // reportes de departamento
app.use('/dashboard',  dashboardRoutes); // dashboard analítico
app.use('/revisiones', revisionesRoutes); // módulo de revisiones/contadores
app.use('/api',        bitacorasRoutes);  // bitácoras de turno
app.use('/api',        ticketsRoutes);   // tickets del sync (CyberPlanet)
app.use('/api',        inventarioRoutes); // inventario — descarga de Excel
app.use('/api',        promocionesRoutes); // promociones del panel de cliente
app.use('/api',        fotosRoutes);       // fotos de sucursal para el panel de cliente

// =============================================================
//  ARRANCAR
// =============================================================
const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
  console.log(`✓ Servidor i24h corriendo en http://localhost:${PUERTO}`);
  console.log('  Presiona Ctrl + C para detenerlo.');
});
