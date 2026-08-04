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
const limiteMarcar = rateLimit({ windowMs: 5 * 60 * 1000, max: 30 });
// Mismo límite que servidor.js usa para el resto de las rutas /api/
const limiteApi = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

// Único lugar donde se define qué transición es válida desde cada estado.
// La usan tanto la generación del QR (para decidir qué botones mostrar) como
// la confirmación (para validar antes de escribir) — así nunca quedan
// desincronizadas.
const TRANSICIONES_VALIDAS = {
  fuera:      ['entrada'],
  trabajando: ['salida', 'inicio_comida'],
  en_comida:  ['fin_comida'],
};

const ETIQUETAS_TIPO = {
  entrada:       'entrada',
  salida:        'salida',
  inicio_comida: 'inicio de comida',
  fin_comida:    'fin de comida',
};

// Cargos que pueden escanear/confirmar el QR personal de cualquier empleado
// (incluido el de otro supervisor de igual o menor rango). Decisión del
// usuario 2026-08-03: Encargado, Líder, Coordinador o Admin — más amplio que
// requireAdmin (que solo cubre admin/coordinador).
const CARGOS_SUPERVISOR = ['admin', 'coordinador', 'lider', 'encargado'];

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

function requireSupervisor(req, res, next) {
  const cargo = req.session.usuario?.cargo;
  if (!CARGOS_SUPERVISOR.includes(cargo)) {
    return res.status(403).json({ error: 'Tu cuenta no tiene permiso para confirmar marcaciones de asistencia.' });
  }
  next();
}

function bloquearCliente(req, res, next) {
  if (req.session.usuario?.cargo === 'cliente') {
    return res.status(403).json({ error: 'Esta acción no está disponible para cuentas de cliente.' });
  }
  next();
}

// ── QR personal por empleado (en memoria, no en BD — vive 2 minutos) ─────
// Cada empleado tiene a lo sumo un token pendiente a la vez: generar uno
// nuevo reemplaza el anterior. El tipo y la sucursal quedan fijados acá,
// server-side, en el momento de generar el QR — nunca se confían del
// cliente al confirmar.
const QR_TTL_MS = 2 * 60 * 1000;
const tokensPorEmpleado = new Map(); // empleadoId -> { token, expiresAt, tipo, sucursal }

function crearToken(empleadoId, tipo, sucursal) {
  const entry = {
    token: crypto.randomBytes(16).toString('hex'),
    expiresAt: Date.now() + QR_TTL_MS,
    tipo,
    sucursal,
  };
  tokensPorEmpleado.set(String(empleadoId), entry);
  return entry;
}

// Comparación en tiempo constante (defensa en profundidad contra timing
// attacks) — el token es corto e imposible de adivinar por fuerza bruta
// igual, pero comparar con === filtra timing por diferencia de caracteres
// y es gratis evitarlo.
function tokensIguales(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function buscarTokenValido(token) {
  if (typeof token !== 'string' || !token) return null;
  for (const [empleadoId, entry] of tokensPorEmpleado.entries()) {
    if (entry.expiresAt > Date.now() && tokensIguales(entry.token, token)) {
      return { empleadoId, ...entry };
    }
  }
  return null;
}

function invalidarToken(empleadoId) {
  tokensPorEmpleado.delete(String(empleadoId));
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

async function registrarEvento(empleadoId, sucursal, tipo, confirmadoPor, autoConfirmado) {
  const fecha = new Date();
  const turno = (tipo === 'entrada') ? await turnoAsignado(empleadoId, sucursal, fecha) : null;
  await AsistenciaEvento.create({
    empleado_id: empleadoId,
    sucursal,
    tipo,
    turno,
    timestamp: fecha,
    confirmado_por: confirmadoPor || null,
    auto_confirmado: !!autoConfirmado,
  });
}

// ── GET /asistencia/api/estado ─────────────────────────────────────────
// Estado actual del empleado logueado + qué transición(es) puede marcar +
// en qué sucursales puede hacerlo. Alimenta el tab "Marcar asistencia".
router.get('/api/estado', limiteApi, requireAuth, bloquearCliente, async (req, res) => {
  try {
    const u = req.session.usuario;
    const estado = await estadoActual(u.id);
    const opciones = TRANSICIONES_VALIDAS[estado];
    const perfil = await Usuario.findById(u.id).select('sucursales').lean();
    const sucursales = (perfil?.sucursales?.length ? perfil.sucursales : SUCURSALES);
    res.json({ estado, opciones, sucursales });
  } catch (err) {
    console.error('[ASISTENCIA estado]', err);
    res.status(500).json({ error: 'Error al consultar tu estado de asistencia' });
  }
});

// ── POST /asistencia/api/generar-qr ────────────────────────────────────
// Genera el QR personal de 2 minutos para una transición concreta. Revalida
// server-side que la transición sea legal antes de crear el token — nunca
// confía en lo que mandó el cliente.
router.post('/api/generar-qr', limiteMarcar, requireAuth, bloquearCliente, async (req, res) => {
  try {
    const { tipo, sucursal } = req.body;
    if (!SUCURSALES.includes(sucursal)) {
      return res.status(400).json({ error: 'Sucursal no reconocida' });
    }

    const estado = await estadoActual(req.session.usuario.id);
    if (!TRANSICIONES_VALIDAS[estado]?.includes(tipo)) {
      return res.status(409).json({ error: 'Ese tipo de marcación ya no es válido, recargá la página' });
    }

    const entry = crearToken(req.session.usuario.id, tipo, sucursal);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const urlConfirmar = `${baseUrl}/asistencia/confirmar?token=${entry.token}`;

    const qrDataUrl = await QRCode.toDataURL(urlConfirmar, {
      width: 320,
      margin: 2,
      color: { dark: '#1e0a0a', light: '#ffffff' },
    });

    res.json({ token: entry.token, qrDataUrl, expiresAt: entry.expiresAt, tipo, sucursal });
  } catch (err) {
    console.error('[ASISTENCIA generar-qr]', err);
    res.status(500).json({ error: 'Error generando el código QR' });
  }
});

// ── GET /asistencia/confirmar ──────────────────────────────────────────
// Landing al escanear el QR personal de otro empleado con la cámara nativa
// del teléfono. Requiere sesión propia con rango de supervisión.
//
// IMPORTANTE: este handler NO escribe en la base de datos. Un GET nunca
// debe tener efectos secundarios (semántica HTTP) — si registrara la
// marcación acá directo, un prefetch del navegador, un escáner de links de
// un cliente de correo/chat, o alguien reenviando el link con el token
// vigente podría confirmar una entrada/salida falsa sin que nadie hiciera
// nada. Por eso solo muestra qué se va a confirmar, y la escritura real
// queda en el POST /api/confirmar de abajo, que el supervisor dispara con
// un tap.
router.get('/confirmar', limiteMarcar, async (req, res) => {
  const { token } = req.query;
  const usuarioSesion = req.session.usuario;

  const render = (extra) => res.render('asistencia/confirmar', {
    layout: 'main',
    titulo: 'Confirmar asistencia',
    estiloExtra: 'css/asistencia.css',
    ...extra,
  });

  if (!usuarioSesion || usuarioSesion.cargo === 'cliente') {
    return render({ error: 'Iniciá sesión con tu cuenta de empleado en el panel y volvé a escanear el código.' });
  }

  if (!CARGOS_SUPERVISOR.includes(usuarioSesion.cargo)) {
    return render({ error: 'Tu cuenta no tiene permiso para confirmar marcaciones de asistencia.' });
  }

  const encontrado = buscarTokenValido(token);
  if (!encontrado) {
    return render({ error: 'Este código ya venció. Pedile a la persona que genere uno nuevo desde su panel.' });
  }

  const empleado = await Usuario.findById(encontrado.empleadoId).select('nombre').lean();
  if (!empleado) {
    return render({ error: 'No se encontró a la persona dueña de este código.' });
  }

  return render({
    confirmar: true,
    token: encontrado.token,
    nombre: empleado.nombre,
    tipo: encontrado.tipo,
    tipoTexto: ETIQUETAS_TIPO[encontrado.tipo] || encontrado.tipo,
    sucursal: encontrado.sucursal,
  });
});

// ── POST /asistencia/api/confirmar ─────────────────────────────────────
// Único lugar (junto con autoconfirmar) que efectivamente escribe un
// AsistenciaEvento vía este flujo. Revalida todo server-side.
router.post('/api/confirmar', limiteMarcar, requireAuth, requireSupervisor, async (req, res) => {
  try {
    const { token } = req.body;
    const encontrado = buscarTokenValido(token);
    if (!encontrado) return res.status(410).json({ error: 'El código venció, pedile a la persona que genere uno nuevo' });

    const estado = await estadoActual(encontrado.empleadoId);
    if (!TRANSICIONES_VALIDAS[estado]?.includes(encontrado.tipo)) {
      invalidarToken(encontrado.empleadoId);
      return res.status(409).json({ error: 'El estado de esa persona ya cambió, pedile que genere un código nuevo' });
    }

    await registrarEvento(encontrado.empleadoId, encontrado.sucursal, encontrado.tipo, req.session.usuario.id, false);
    invalidarToken(encontrado.empleadoId);
    res.json({ ok: true, tipo: encontrado.tipo, etiqueta: ETIQUETAS_TIPO[encontrado.tipo] });
  } catch (err) {
    console.error('[ASISTENCIA confirmar]', err);
    res.status(500).json({ error: 'Error al confirmar la marcación' });
  }
});

// ── POST /asistencia/api/autoconfirmar ─────────────────────────────────
// Fallback para cuando un supervisor (encargado/líder/coordinador/admin)
// está solo en el turno y no hay nadie más con rango para escanearle. Solo
// puede autoconfirmar su propio token pendiente.
router.post('/api/autoconfirmar', limiteMarcar, requireAuth, requireSupervisor, async (req, res) => {
  try {
    const { token } = req.body;
    const encontrado = buscarTokenValido(token);
    if (!encontrado) return res.status(410).json({ error: 'El código venció, generá uno nuevo' });

    if (String(encontrado.empleadoId) !== String(req.session.usuario.id)) {
      return res.status(403).json({ error: 'Solo podés autoconfirmar tu propio código' });
    }

    const estado = await estadoActual(encontrado.empleadoId);
    if (!TRANSICIONES_VALIDAS[estado]?.includes(encontrado.tipo)) {
      invalidarToken(encontrado.empleadoId);
      return res.status(409).json({ error: 'Tu estado ya cambió, recargá la página' });
    }

    await registrarEvento(encontrado.empleadoId, encontrado.sucursal, encontrado.tipo, req.session.usuario.id, true);
    invalidarToken(encontrado.empleadoId);
    res.json({ ok: true, tipo: encontrado.tipo, etiqueta: ETIQUETAS_TIPO[encontrado.tipo] });
  } catch (err) {
    console.error('[ASISTENCIA autoconfirmar]', err);
    res.status(500).json({ error: 'Error al autoconfirmar la marcación' });
  }
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

// ── GET /asistencia/api/reporte ────────────────────────────────────────
// Detalle día a día (a diferencia de horas-trabajadas, que agrega toda la
// semana en un solo total): una fila por cada par entrada→salida, con hora
// exacta de entrada/salida y quién confirmó. Alimenta el tab "Reporte" del
// panel. soloIncompletos=1 filtra a jornadas por debajo de lo esperado.
router.get('/api/reporte', limiteApi, requireAuth, requireAdmin, async (req, res) => {
  try {
    const semana = req.query.semana || isoWeekStr(new Date());
    const sucursalFiltro = req.query.sucursal || 'todas';
    const soloIncompletos = req.query.soloIncompletos === '1';

    const inicio = getViernesDeISO(semana);
    const fin = new Date(inicio);
    fin.setDate(inicio.getDate() + 7);

    const eventos = await AsistenciaEvento.find({ timestamp: { $gte: inicio, $lt: fin } })
      .sort({ empleado_id: 1, timestamp: 1 })
      .lean();

    if (eventos.length === 0) return res.json({ semana, filas: [] });

    const empleadoIds = [...new Set(eventos.map(e => String(e.empleado_id)))];
    const confirmadorIds = [...new Set(eventos.filter(e => e.confirmado_por).map(e => String(e.confirmado_por)))];
    const todosIds = [...new Set([...empleadoIds, ...confirmadorIds])];
    const usuarios = await Usuario.find({ _id: { $in: todosIds } })
      .select('nombre horasPersonalizadas')
      .lean();
    const usuarioPorId = new Map(usuarios.map(u => [String(u._id), u]));

    const eventosPorEmpleado = new Map();
    for (const ev of eventos) {
      const key = String(ev.empleado_id);
      if (!eventosPorEmpleado.has(key)) eventosPorEmpleado.set(key, []);
      eventosPorEmpleado.get(key).push(ev);
    }

    const filas = [];
    for (const [empleadoId, evs] of eventosPorEmpleado.entries()) {
      const empleado = usuarioPorId.get(empleadoId);
      if (!empleado) continue;

      let entradaAbierta = null; // { ts, sucursal, turno, confirmadoPor, autoConfirmado }
      let comidaAbierta = null;  // Date
      let horasComidaAcum = 0;

      for (const ev of evs) {
        const ts = new Date(ev.timestamp);
        if (ev.tipo === 'entrada') {
          entradaAbierta = {
            ts,
            sucursal: ev.sucursal,
            turno: ev.turno,
            confirmadoPor: ev.confirmado_por,
            autoConfirmado: ev.auto_confirmado,
          };
          horasComidaAcum = 0;
        } else if (ev.tipo === 'inicio_comida') {
          comidaAbierta = ts;
        } else if (ev.tipo === 'fin_comida') {
          if (comidaAbierta) horasComidaAcum += (ts - comidaAbierta) / 3_600_000;
          comidaAbierta = null;
        } else if (ev.tipo === 'salida') {
          if (entradaAbierta && (sucursalFiltro === 'todas' || entradaAbierta.sucursal === sucursalFiltro)) {
            const horasTotales = (ts - entradaAbierta.ts) / 3_600_000;
            const horasNetas = Math.max(0, horasTotales - horasComidaAcum);

            let horasEsperadas = null;
            if (empleado.horasPersonalizadas != null) horasEsperadas = empleado.horasPersonalizadas;
            else if (entradaAbierta.turno) horasEsperadas = TURNOS[entradaAbierta.turno]?.horas ?? null;

            const diferencia = horasEsperadas != null ? Math.round((horasNetas - horasEsperadas) * 100) / 100 : null;
            const confirmador = entradaAbierta.confirmadoPor ? usuarioPorId.get(String(entradaAbierta.confirmadoPor)) : null;
            let confirmadoPorTexto = null;
            if (entradaAbierta.autoConfirmado) confirmadoPorTexto = `${empleado.nombre} (auto)`;
            else if (confirmador) confirmadoPorTexto = confirmador.nombre;

            filas.push({
              empleadoId,
              nombre: empleado.nombre,
              sucursal: entradaAbierta.sucursal,
              fecha: entradaAbierta.ts.toISOString().slice(0, 10),
              horaEntrada: entradaAbierta.ts,
              horaSalida: ts,
              horasTrabajadas: Math.round(horasNetas * 100) / 100,
              horasComida: Math.round(horasComidaAcum * 100) / 100,
              horasEsperadas,
              diferencia,
              turno: entradaAbierta.turno,
              confirmadoPor: confirmadoPorTexto,
            });
          }
          entradaAbierta = null;
          comidaAbierta = null;
          horasComidaAcum = 0;
        }
      }
    }

    const filasFiltradas = soloIncompletos
      ? filas.filter(f => f.diferencia != null && f.diferencia < 0)
      : filas;

    filasFiltradas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));
    res.json({ semana, filas: filasFiltradas });
  } catch (err) {
    console.error('[ASISTENCIA reporte]', err);
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

export default router;
