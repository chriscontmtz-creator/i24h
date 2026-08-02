import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import AsistenciaEvento from '../models/AsistenciaEvento.js';
import Usuario from '../models/Usuario.js';
import Horario from '../models/Horario.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';

const router = Router();

// Este módulo no vive bajo /api/, así que no hereda el rate limit global
// de servidor.js (app.use('/api/', rateLimit(...))) — se le pone el suyo.
const limitePantalla = rateLimit({ windowMs: 5 * 60 * 1000, max: 60 });
const limiteMarcar   = rateLimit({ windowMs: 5 * 60 * 1000, max: 30 });
// Mismo límite que servidor.js usa para el resto de las rutas /api/
const limiteApi = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

// Único lugar donde se define qué transición es válida desde cada estado.
// La usan tanto el GET (para decidir qué mostrar) como el POST (para
// validar antes de escribir) — así nunca quedan desincronizados.
const TRANSICIONES_VALIDAS = {
  fuera:      ['entrada'],
  trabajando: ['salida', 'inicio_comida'],
  en_comida:  ['fin_comida'],
};

// Misma lista que src/routes/horarios.js — duplicada a propósito en vez de
// importada, para no tocar ese archivo (pedido explícito del usuario).
const SUCURSALES = [
  'Simón Bolívar',
  'Insurgentes',
  'Antígona',
  'Lincoln Oxxo',
  'Lincoln 2',
  'Ruiz Cortines',
  'Rodas',
  'Cuauhtémoc',
  'Ordóñez',
];

// Horarios reales de cada turno (confirmados por el usuario 2026-08-02).
// T1/T2/T3 se solapan a propósito (relevo de turno).
const TURNOS = {
  T1: { inicio: '07:00', fin: '15:30', horas: 8.5 },
  T2: { inicio: '14:00', fin: '22:30', horas: 8.5 },
  T3: { inicio: '22:00', fin: '07:00', horas: 9, cruzaMedianoche: true },
};

// ── Tokens efímeros del QR (en memoria, no en BD — viven ~25s) ───────────
const TOKEN_TTL_MS = 25_000;
const tokensPorSucursal = new Map(); // sucursal -> { token, expiresAt }

function tokenVigente(sucursal) {
  const actual = tokensPorSucursal.get(sucursal);
  if (actual && actual.expiresAt > Date.now()) return actual;
  const nuevo = { token: crypto.randomBytes(16).toString('hex'), expiresAt: Date.now() + TOKEN_TTL_MS };
  tokensPorSucursal.set(sucursal, nuevo);
  return nuevo;
}

// Comparación en tiempo constante (defensa en profundidad contra timing
// attacks) — el token es corto (25s) e imposible de adivinar por fuerza
// bruta igual, pero comparar con === filtra timing por diferencia de
// caracteres y es gratis evitarlo.
function tokensIguales(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function buscarSucursalPorToken(token) {
  if (typeof token !== 'string' || !token) return null;
  for (const [sucursal, entry] of tokensPorSucursal.entries()) {
    if (entry.expiresAt > Date.now() && tokensIguales(entry.token, token)) return sucursal;
  }
  return null;
}

// ── Semana de pago viernes→jueves (misma lógica que public/js/horarios.js,
//    portada a Node para poder calcular el rango de fechas server-side) ──
function isoWeekStr(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

function getViernesDeISO(weekStr) {
  const [yearStr, weekStrNo] = weekStr.split('-');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStrNo, 10);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7; // 0=Lun … 6=Dom
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  const viernes = new Date(monday);
  viernes.setDate(monday.getDate() - 3);
  viernes.setHours(0, 0, 0, 0);
  return viernes;
}

// Convierte una fecha a índice de día con Viernes=0 … Jueves=6 (mismo
// orden que la grilla de Horarios: Vie Sáb Dom Lun Mar Mié Jue).
function diaIndexDesdeViernes(date) {
  const mapa = { 5: 0, 6: 1, 0: 2, 1: 3, 2: 4, 3: 5, 4: 6 };
  return mapa[date.getDay()];
}

// Busca en Horario si el empleado tiene un turno asignado ese día/sucursal.
// Best-effort: si algo falla o no hay match, devuelve null sin romper el flujo.
async function turnoAsignado(empleadoId, sucursal, fecha) {
  try {
    const semana = isoWeekStr(fecha);
    const horario = await Horario.findOne({ sucursal, semana }).lean();
    if (!horario) return null;
    const diaIdx = diaIndexDesdeViernes(fecha);
    for (const t of ['T1', 'T2', 'T3']) {
      const celda = (horario.turnos?.[t] || []).find(c => c.dia === diaIdx);
      if (celda?.empleados?.some(id => String(id) === String(empleadoId))) return t;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Estado de asistencia de un empleado (según su último evento, en
//    cualquier sucursal) ───────────────────────────────────────────────
async function estadoActual(empleadoId) {
  const ultimo = await AsistenciaEvento.findOne({ empleado_id: empleadoId }).sort({ timestamp: -1 }).lean();
  if (!ultimo || ultimo.tipo === 'salida') return 'fuera';
  if (ultimo.tipo === 'inicio_comida') return 'en_comida';
  return 'trabajando'; // último fue 'entrada' o 'fin_comida'
}

// ── GET /asistencia/pantalla/:sucursal ────────────────────────────────
// Pantalla de kiosco (sin login) para dejar abierta en la PC de Recepción.
// Muestra un QR que se renueva solo cada TOKEN_TTL_MS.
router.get('/pantalla/:sucursal', limitePantalla, (req, res) => {
  const { sucursal } = req.params;
  if (!SUCURSALES.includes(sucursal)) return res.status(404).send('Sucursal no reconocida');

  const { token } = tokenVigente(sucursal);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const urlMarcar = `${baseUrl}/asistencia/marcar?token=${token}`;

  QRCode.toDataURL(urlMarcar, { width: 420, margin: 2, color: { dark: '#1e0a0a', light: '#ffffff' } })
    .then(qrDataUrl => {
      res.render('asistencia/pantalla', {
        layout: 'main',
        titulo: `Asistencia — ${sucursal}`,
        estiloExtra: 'css/asistencia.css',
        sucursal,
        qrDataUrl,
        refrescarMs: TOKEN_TTL_MS,
      });
    })
    .catch(() => res.status(500).send('Error generando el código QR'));
});

// ── GET /asistencia/marcar ─────────────────────────────────────────────
// Landing al escanear el QR. Requiere sesión propia (no requireAuth directo,
// porque acá conviene una página amigable en vez de un 401 en JSON).
//
// IMPORTANTE: este handler NO escribe en la base de datos. Un GET nunca
// debe tener efectos secundarios (semántica HTTP) — si registrara la
// marcación acá directo, un prefetch del navegador, un escáner de links de
// un cliente de correo/chat, o alguien mandando el link con el token
// vigente podría marcar una entrada/salida falsa sin que la persona hiciera
// nada. Por eso solo muestra qué se va a marcar, y la escritura real queda
// en el POST /api/marcar de abajo, que el empleado dispara con un tap.
router.get('/marcar', limiteMarcar, async (req, res) => {
  const { token } = req.query;
  const usuarioSesion = req.session.usuario;

  const render = (extra) => res.render('asistencia/marcar', {
    layout: 'main',
    titulo: 'Marcar asistencia',
    estiloExtra: 'css/asistencia.css',
    ...extra,
  });

  if (!usuarioSesion || usuarioSesion.cargo === 'cliente') {
    return render({ error: 'Iniciá sesión con tu cuenta de empleado en el panel y volvé a escanear el código.' });
  }

  const sucursal = buscarSucursalPorToken(token);
  if (!sucursal) {
    return render({ error: 'Este código ya venció. Escaneá el código que está en pantalla en este momento.' });
  }

  const estado = await estadoActual(usuarioSesion.id);
  const opciones = TRANSICIONES_VALIDAS[estado];

  return render({ confirmar: true, opciones, token, sucursal });
});

async function registrarEvento(empleadoId, sucursal, tipo) {
  const fecha = new Date();
  const turno = (tipo === 'entrada') ? await turnoAsignado(empleadoId, sucursal, fecha) : null;
  await AsistenciaEvento.create({ empleado_id: empleadoId, sucursal, tipo, turno, timestamp: fecha });
}

// ── POST /asistencia/api/marcar ────────────────────────────────────────
// Único lugar que efectivamente escribe un AsistenciaEvento. Revalida todo
// server-side (token vigente + que 'tipo' sea una transición legal desde el
// estado real del empleado en este momento) — nunca confía en lo que mandó
// la vista de confirmación.
router.post('/api/marcar', requireAuth, limiteMarcar, async (req, res) => {
  const { token, tipo } = req.body;

  const sucursal = buscarSucursalPorToken(token);
  if (!sucursal) return res.status(410).json({ error: 'El código venció, escaneá de nuevo' });

  const estado = await estadoActual(req.session.usuario.id);
  if (!TRANSICIONES_VALIDAS[estado]?.includes(tipo)) {
    return res.status(409).json({ error: 'Tu estado ya cambió, recargá la página' });
  }

  await registrarEvento(req.session.usuario.id, sucursal, tipo);
  res.json({ ok: true, tipo });
});

// ── GET /asistencia/api/horas-trabajadas ───────────────────────────────
// Reporte semanal (viernes→jueves), agrupado por empleado + sucursal.
router.get('/api/horas-trabajadas', limiteApi, requireAuth, requireAdmin, async (req, res) => {
  try {
    const semana = req.query.semana || isoWeekStr(new Date());
    const sucursalFiltro = req.query.sucursal || 'todas';

    const inicio = getViernesDeISO(semana);
    const fin = new Date(inicio);
    fin.setDate(inicio.getDate() + 7);

    const eventos = await AsistenciaEvento.find({ timestamp: { $gte: inicio, $lt: fin } })
      .sort({ empleado_id: 1, timestamp: 1 })
      .lean();

    if (eventos.length === 0) return res.json({ semana, filas: [] });

    const empleadoIds = [...new Set(eventos.map(e => String(e.empleado_id)))];
    const empleados = await Usuario.find({ _id: { $in: empleadoIds } })
      .select('nombre horasPersonalizadas')
      .lean();
    const empleadoPorId = new Map(empleados.map(e => [String(e._id), e]));

    // Agrupa eventos por empleado, en orden cronológico
    const eventosPorEmpleado = new Map();
    for (const ev of eventos) {
      const key = String(ev.empleado_id);
      if (!eventosPorEmpleado.has(key)) eventosPorEmpleado.set(key, []);
      eventosPorEmpleado.get(key).push(ev);
    }

    const filas = [];
    for (const [empleadoId, evs] of eventosPorEmpleado.entries()) {
      const empleado = empleadoPorId.get(empleadoId);
      if (!empleado) continue;

      // sucursal -> { horasTrabajo, horasComida, diasConEntrada, turnosVistos: Set }
      const porSucursal = new Map();
      const acumular = (sucursal, campo, horas) => {
        if (!porSucursal.has(sucursal)) {
          porSucursal.set(sucursal, { horasTrabajo: 0, horasComida: 0, diasConEntrada: 0, turnos: [] });
        }
        porSucursal.get(sucursal)[campo] += horas;
      };

      let entradaAbierta = null; // { timestamp, sucursal, turno }
      let comidaAbierta = null;  // { timestamp }

      for (const ev of evs) {
        const ts = new Date(ev.timestamp);
        if (ev.tipo === 'entrada') {
          entradaAbierta = { timestamp: ts, sucursal: ev.sucursal, turno: ev.turno };
          if (!porSucursal.has(ev.sucursal)) porSucursal.set(ev.sucursal, { horasTrabajo: 0, horasComida: 0, diasConEntrada: 0, turnos: [] });
          const reg = porSucursal.get(ev.sucursal);
          reg.diasConEntrada += 1;
          if (ev.turno) reg.turnos.push(ev.turno);
        } else if (ev.tipo === 'inicio_comida') {
          comidaAbierta = { timestamp: ts };
        } else if (ev.tipo === 'fin_comida') {
          if (comidaAbierta && entradaAbierta) {
            const horas = (ts - comidaAbierta.timestamp) / 3_600_000;
            acumular(entradaAbierta.sucursal, 'horasComida', horas);
          }
          comidaAbierta = null;
        } else if (ev.tipo === 'salida') {
          if (entradaAbierta) {
            const horasTotales = (ts - entradaAbierta.timestamp) / 3_600_000;
            acumular(entradaAbierta.sucursal, 'horasTrabajo', horasTotales);
          }
          entradaAbierta = null;
          comidaAbierta = null;
        }
      }

      for (const [sucursal, datos] of porSucursal.entries()) {
        if (sucursalFiltro !== 'todas' && sucursal !== sucursalFiltro) continue;

        const horasTrabajadasNetas = Math.max(0, datos.horasTrabajo - datos.horasComida);

        let horasEsperadas = null;
        if (empleado.horasPersonalizadas != null) {
          horasEsperadas = empleado.horasPersonalizadas * datos.diasConEntrada;
        } else if (datos.turnos.length > 0) {
          horasEsperadas = datos.turnos.reduce((acc, t) => acc + (TURNOS[t]?.horas || 0), 0);
        }

        filas.push({
          empleadoId,
          nombre: empleado.nombre,
          sucursal,
          horasTrabajadas: Math.round(horasTrabajadasNetas * 100) / 100,
          horasComida: Math.round(datos.horasComida * 100) / 100,
          horasEsperadas: horasEsperadas != null ? Math.round(horasEsperadas * 100) / 100 : null,
          diferencia: horasEsperadas != null ? Math.round((horasTrabajadasNetas - horasEsperadas) * 100) / 100 : null,
        });
      }
    }

    filas.sort((a, b) => a.nombre.localeCompare(b.nombre) || a.sucursal.localeCompare(b.sucursal));
    res.json({ semana, filas });
  } catch (err) {
    console.error('[ASISTENCIA horas-trabajadas]', err);
    res.status(500).json({ error: 'Error al calcular horas trabajadas' });
  }
});

export default router;
