import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { soloAdmin }   from '../middlewares/soloAdmin.js';
import { sucursalPermitida } from '../utils/sucursales.js';
import Ticket        from '../models/Ticket.js';
import AjusteTicket  from '../models/AjusteTicket.js';
import Producto      from '../models/Producto.js';
import Categoria     from '../models/Categoria.js';
import CorteCaja     from '../models/CorteCaja.js';

const router = Router();

// ── Sucursales: el sync guarda sin acentos/espacios, el panel usa nombres
//    completos (mismo patrón que src/routes/tickets.js) ───────────────────
const VARIANTES = {
  'Simón Bolívar': ['SimonBolivar', 'Simón Bolívar', 'Simon Bolivar'],
  'Insurgentes':   ['Insurgentes'],
  'Antígona':      ['Antigona', 'Antígona'],
  'Lincoln Oxxo':  ['LincolnOxxo', 'Lincoln Oxxo'],
  'Lincoln 2':     ['Lincoln2', 'Lincoln 2'],
  'Ruiz Cortines': ['RuizCortines', 'Ruiz Cortines'],
  'Rodas':         ['Rodas'],
  'Cuauhtémoc':    ['Cuauhtemoc', 'Cuauhtémoc'],
  'Ordóñez':       ['Ordonez', 'Ordóñez'],
};

function filtroSucursal(suc) {
  if (!suc || suc === 'todas') return {};
  return { sucursal: { $in: VARIANTES[suc] || [suc] } };
}

// OJO: Ticket.fecha se guarda como medianoche UTC exacta del día calendario
// (confirmado con datos reales: 2026-09-07T00:00:00.000Z, no hay desfase de
// huso horario) — la hora real de cada venta vive aparte en lineas[].hora.
// src/routes/tickets.js tiene una función con el mismo nombre que SÍ le resta
// 6h (asumiendo que fecha viene en hora México sin convertir); esa función
// nunca matchea ningún ticket real con ninguna fecha — no se tocó ese
// archivo porque no se pidió, pero vale la pena revisarlo aparte.
function rangoDiaMX(fechaStr) {
  let y, m, d;
  if (fechaStr) {
    [y, m, d] = fechaStr.split('-').map(Number);
  } else {
    const hoy = new Date();
    const mx = new Date(hoy.getTime() - 6 * 60 * 60 * 1000);
    y = mx.getUTCFullYear(); m = mx.getUTCMonth() + 1; d = mx.getUTCDate();
  }
  return {
    $gte: new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)),
    $lt:  new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0)),
  };
}

// ── "Material" — productos que no cuentan como venta real del departamento.
//    Se resuelve dinámicamente por categoría real de CyberPlanet (Categoria/
//    Producto, sincronizadas), no por palabra clave — confirmado con datos
//    reales de Simón Bolívar 2026-08-02: la categoría "MATERIAL" (código 117
//    ahí) contiene exactamente cartulina/legajos/memoria usb, "NOVEDADES"
//    (112) y "SNACK" (1) son categorías propias. Los códigos numéricos son
//    por sucursal (cada CyberPlanet los asigna independiente), por eso se
//    busca por nombre de categoría, no por código fijo.
const NOMBRES_CATEGORIA_EXCLUIDA = ['MATERIAL', 'NOVEDADES', 'SNACK'];

// Devuelve el set de nombres de producto (en mayúsculas) que caen en esas
// categorías para la sucursal dada — Ticket.lineas[].detalle coincide
// exacto con Producto.nombre (confirmado con datos reales).
async function nombresProductosExcluidos(sucursal) {
  const categorias = await Categoria.find({
    ...filtroSucursal(sucursal),
    nombre: { $in: NOMBRES_CATEGORIA_EXCLUIDA.map(n => new RegExp(`^${n}$`, 'i')) },
  }).select('codigo -_id').lean();

  if (!categorias.length) return new Set();

  const productos = await Producto.find({
    ...filtroSucursal(sucursal),
    codCategoria: { $in: categorias.map(c => c.codigo) },
  }).select('nombre -_id').lean();

  return new Set(productos.map(p => p.nombre.trim().toUpperCase()));
}

// ── Turno a partir de la hora de la línea. Ventanas SIN solapamiento
//    (a diferencia de los turnos reales de empleados en asistencia.js, que
//    sí se solapan para el relevo) — acá es solo para agrupar el reporte,
//    cada línea cae en un único turno.
function turnoDesdeHora(horaStr) {
  if (!horaStr) return null;
  const match = String(horaStr).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutos = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  if (minutos >= 7 * 60 && minutos < 14 * 60)  return 'T1'; // 07:00–13:59
  if (minutos >= 14 * 60 && minutos < 22 * 60) return 'T2'; // 14:00–21:59
  return 'T3';                                              // 22:00–06:59
}

// ── Turno a partir del campo libre CorteCaja.operador1 ("Turno1", "Turno 2"…).
//    Mismo patrón que revisiones.js:11-14 (turnoCorto) — se duplica acá en vez
//    de importar porque revisiones.js no lo exporta.
function turnoCorto(operador) {
  const m = (operador || '').match(/Turno\s*(\d)/i);
  return m ? 'T' + m[1] : null;
}

// ── "Actas" — categorías con un producto base a $50 (servicio, nombre igual
//    al de la categoría) + un producto por estado con el costo real de
//    gobierno (ej. NUEVOLEON2 -> $70). Confirmado con datos reales de
//    SimonBolivar/Simón Bolívar/TestSucursal 2026-08-04: mismo patrón en las
//    tres. La línea "de estado" (nombre != nombre de categoría) es el pago a
//    gobierno que va al sobre SDA; la línea base ($50) es venta normal.
const NOMBRES_CATEGORIA_ACTA = ['ACTA DE MATRIMONIO', 'ACTA DE DEFUNCION', 'ACTA DE NACIMIENTO'];

// Devuelve el set de nombres de producto (en mayúsculas) que son la línea "de
// estado" (pago a gobierno) dentro de las categorías de acta — espejo de
// nombresProductosExcluidos() de arriba, mismo patrón de resolución dinámica
// por nombre de categoría (los códigos son por sucursal).
async function nombresProductosActaEstado(sucursal) {
  const categorias = await Categoria.find({
    ...filtroSucursal(sucursal),
    nombre: { $in: NOMBRES_CATEGORIA_ACTA.map(n => new RegExp(`^${n}$`, 'i')) },
  }).select('codigo nombre -_id').lean();

  if (!categorias.length) return new Set();

  const nombreCategoriaPorCodigo = new Map(
    categorias.map(c => [c.codigo, c.nombre.trim().toUpperCase()])
  );

  const productos = await Producto.find({
    ...filtroSucursal(sucursal),
    codCategoria: { $in: categorias.map(c => c.codigo) },
  }).select('nombre codCategoria -_id').lean();

  const set = new Set();
  for (const p of productos) {
    const nombreProd = p.nombre.trim().toUpperCase();
    const nombreCat  = nombreCategoriaPorCodigo.get(p.codCategoria);
    if (nombreProd !== nombreCat) set.add(nombreProd); // no es la línea base $50
  }
  return set;
}

// ── GET /api/material/resumen?sucursal=&fecha= ─────────────────────────
// Ventas de "material" (no cuentan como venta real), agrupadas por
// caja + turno, para poder restarlas del total del día.
router.get('/material/resumen', requireAuth, async (req, res) => {
  try {
    const { sucursal, fecha } = req.query;
    if (sucursal && sucursal !== 'todas' && !(await sucursalPermitida(req.session.usuario, sucursal)))
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esa sucursal.' });
    if ((!sucursal || sucursal === 'todas') && req.session.usuario.cargo !== 'admin')
      return res.status(403).json({ ok: false, error: 'Selecciona una sucursal.' });
    const match = {
      ...filtroSucursal(sucursal),
      fecha: rangoDiaMX(fecha),
      anulado: false,
    };

    const [tickets, nombresExcluidos] = await Promise.all([
      Ticket.find(match).lean(),
      nombresProductosExcluidos(sucursal),
    ]);

    // clave "caja|turno" -> { ncaja, turno, unidades, importe, detalleUnico: Set }
    const grupos = new Map();
    let totalMaterial = 0;

    for (const t of tickets) {
      for (const l of (t.lineas || [])) {
        if (![1, 2, 5, 6].includes(l.tipo)) continue; // solo tipos de venta real
        if (!nombresExcluidos.has((l.detalle || '').trim().toUpperCase())) continue;

        const turno = turnoDesdeHora(l.hora);
        const key = `${t.ncaja ?? '—'}|${turno ?? '—'}`;
        if (!grupos.has(key)) {
          grupos.set(key, { ncaja: t.ncaja ?? null, turno, unidades: 0, importe: 0, productos: {} });
        }
        const g = grupos.get(key);
        g.unidades += (l.cantidad || 1);
        g.importe  += (l.importe || 0);
        totalMaterial += (l.importe || 0);

        const nombreProd = (l.detalle || 'Sin detalle').trim();
        g.productos[nombreProd] = (g.productos[nombreProd] || 0) + (l.importe || 0);
      }
    }

    const filas = [...grupos.values()]
      .map(g => ({ ...g, productos: Object.entries(g.productos).map(([nombre, importe]) => ({ nombre, importe })) }))
      .sort((a, b) => (a.ncaja || 0) - (b.ncaja || 0) || String(a.turno).localeCompare(String(b.turno)));

    res.json({ ok: true, totalMaterial, filas });
  } catch (err) {
    console.error('[material] resumen:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/material/buscar-ticket?sucursal=&nticket= ─────────────────
// Busca un ticket puntual para poder aplicarle un descuento por error de
// impresión. Devuelve también los ajustes que ya se le hayan aplicado.
router.get('/material/buscar-ticket', requireAuth, async (req, res) => {
  try {
    const { sucursal, nticket } = req.query;
    if (!sucursal || !nticket) {
      return res.status(400).json({ ok: false, error: 'Faltan sucursal o número de ticket' });
    }
    if (!(await sucursalPermitida(req.session.usuario, sucursal)))
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esa sucursal.' });
    const nticketNum = Number(nticket);
    if (!Number.isFinite(nticketNum)) {
      return res.status(400).json({ ok: false, error: 'Número de ticket inválido' });
    }

    const ticket = await Ticket.findOne({ ...filtroSucursal(sucursal), nticket: nticketNum }).lean();
    if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket no encontrado en esta sucursal' });

    const ajustesPrevios = await AjusteTicket.find({ ...filtroSucursal(sucursal), nticket: nticketNum })
      .sort({ fecha: -1 })
      .lean();

    res.json({ ok: true, ticket, ajustesPrevios });
  } catch (err) {
    console.error('[material] buscar-ticket:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/material/ajuste-ticket ────────────────────────────────────
// Registra el descuento por error de impresión. Solo admin/coordinador
// (mismo nivel de acceso que tenía "Corregir ventas").
router.post('/material/ajuste-ticket', soloAdmin, async (req, res) => {
  try {
    const { nticket, sucursal, montoDescontado, motivo } = req.body;

    const nticketNum = Number(nticket);
    const monto      = Number(montoDescontado);

    if (!sucursal || !Number.isFinite(nticketNum)) {
      return res.status(400).json({ ok: false, error: 'Faltan sucursal o número de ticket válido' });
    }
    if (!(await sucursalPermitida(req.session.usuario, sucursal)))
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esa sucursal.' });
    if (!Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ ok: false, error: 'El monto a descontar debe ser mayor a 0' });
    }
    if (!motivo || !motivo.trim()) {
      return res.status(400).json({ ok: false, error: 'El motivo es obligatorio' });
    }

    const ticket = await Ticket.findOne({ ...filtroSucursal(sucursal), nticket: nticketNum }).lean();
    if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket no encontrado en esta sucursal' });
    if (monto > ticket.importeTotal) {
      return res.status(400).json({ ok: false, error: 'El monto a descontar no puede ser mayor al importe total del ticket' });
    }

    const ajuste = await AjusteTicket.create({
      nticket:         nticketNum,
      sucursal,
      montoDescontado: monto,
      motivo:          motivo.trim(),
      registradoPor:   req.session?.usuario?.nombre || 'Sistema',
    });

    res.json({ ok: true, ajuste });
  } catch (err) {
    console.error('[material] ajuste-ticket:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/material/tickets-dia?sucursal=&fecha= ─────────────────────
// Lista todos los tickets de un día para poder ubicar visualmente el
// dañado por error de impresión (tab "Tickets I24H" del dashboard).
router.get('/material/tickets-dia', requireAuth, async (req, res) => {
  try {
    const { sucursal, fecha } = req.query;
    if (sucursal && sucursal !== 'todas' && !(await sucursalPermitida(req.session.usuario, sucursal)))
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esa sucursal.' });
    if ((!sucursal || sucursal === 'todas') && req.session.usuario.cargo !== 'admin')
      return res.status(403).json({ ok: false, error: 'Selecciona una sucursal.' });
    const match = {
      ...filtroSucursal(sucursal),
      fecha: rangoDiaMX(fecha),
      anulado: false,
    };

    const tickets = await Ticket.find(match)
      .select('nticket ncaja importeTotal lineas sucursal')
      .sort({ nticket: 1 })
      .lean();

    const numeros = tickets.map(t => t.nticket);
    const ajustesTodos = numeros.length
      ? await AjusteTicket.find({ ...filtroSucursal(sucursal), nticket: { $in: numeros } })
          .sort({ fecha: -1 })
          .lean()
      : [];

    const ajustesPorTicket = new Map();
    for (const a of ajustesTodos) {
      if (!ajustesPorTicket.has(a.nticket)) ajustesPorTicket.set(a.nticket, []);
      ajustesPorTicket.get(a.nticket).push(a);
    }

    const filas = tickets.map(t => {
      const ajustes = ajustesPorTicket.get(t.nticket) || [];
      return {
        nticket:         t.nticket,
        ncaja:           t.ncaja ?? null,
        turno:           turnoDesdeHora(t.lineas?.[0]?.hora),
        hora:            t.lineas?.[0]?.hora || null,
        importeTotal:    t.importeTotal || 0,
        totalDescontado: ajustes.reduce((s, a) => s + a.montoDescontado, 0),
        ajustes,
      };
    });

    const total = filas.reduce((s, f) => s + f.importeTotal, 0);

    res.json({ ok: true, tickets: filas, numTickets: filas.length, total });
  } catch (err) {
    console.error('[material] tickets-dia:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/material/corte-turno?sucursal=&fecha= ─────────────────────
// Corte de caja por turno: ingreso (CorteCaja), SDP (sobre de producto),
// SDA (sobre de actas / pago a gobierno), TI24H (venta bruta de tickets) y
// tickets generados, para la pestaña "Corte por turno" del dashboard.
router.get('/material/corte-turno', requireAuth, async (req, res) => {
  try {
    const { sucursal, fecha } = req.query;
    if (!sucursal || sucursal === 'todas') {
      return res.status(400).json({ ok: false, error: 'Selecciona una sucursal' });
    }
    if (!(await sucursalPermitida(req.session.usuario, sucursal)))
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esa sucursal.' });

    const rango = rangoDiaMX(fecha);
    const matchTickets = { ...filtroSucursal(sucursal), fecha: rango, anulado: false };
    const matchCortes  = { ...filtroSucursal(sucursal), fecha: rango };

    const [tickets, cortes, nombresMaterial, nombresActaEstado] = await Promise.all([
      Ticket.find(matchTickets).lean(),
      CorteCaja.find(matchCortes).lean(),
      nombresProductosExcluidos(sucursal),
      nombresProductosActaEstado(sucursal),
    ]);

    const vacio = () => ({ ingreso: 0, sdp: 0, sdaMonto: 0, sdaCantidad: 0, ti24h: 0, ticketsSet: new Set() });
    const turnos = { T1: vacio(), T2: vacio(), T3: vacio() };

    for (const c of cortes) {
      const turno = turnoCorto(c.operador1);
      if (turno && turnos[turno]) turnos[turno].ingreso += (c.ingreso || 0);
    }

    for (const t of tickets) {
      for (const l of (t.lineas || [])) {
        if (![1, 2, 5, 6].includes(l.tipo)) continue;
        const turno = turnoDesdeHora(l.hora);
        if (!turno || !turnos[turno]) continue;

        const nombre = (l.detalle || '').trim().toUpperCase();
        turnos[turno].ti24h += (l.importe || 0);
        turnos[turno].ticketsSet.add(t.nticket);
        if (nombresMaterial.has(nombre))   turnos[turno].sdp += (l.importe || 0);
        if (nombresActaEstado.has(nombre)) {
          turnos[turno].sdaMonto    += (l.importe || 0);
          turnos[turno].sdaCantidad += 1;
        }
      }
    }

    // Promedio histórico de ingreso por turno (últimos 30 días, misma
    // sucursal, excluyendo el día consultado) — base de la "explicación".
    const inicioHistorico = new Date(rango.$gte);
    inicioHistorico.setUTCDate(inicioHistorico.getUTCDate() - 30);
    const cortesHistoricos = await CorteCaja.aggregate([
      { $match: { ...filtroSucursal(sucursal), fecha: { $gte: inicioHistorico, $lt: rango.$gte } } },
      { $group: { _id: '$operador1', promedio: { $avg: '$ingreso' } } },
    ]);
    const promedioPorTurno = {};
    for (const c of cortesHistoricos) {
      const turno = turnoCorto(c._id);
      if (turno) promedioPorTurno[turno] = c.promedio;
    }

    // Tickets extraordinarios (>$300) del día, agrupados por turno.
    const extraordinariosPorTurno = { T1: [], T2: [], T3: [] };
    for (const t of tickets) {
      if ((t.importeTotal || 0) <= 300) continue;
      const turno = turnoDesdeHora(t.lineas?.[0]?.hora);
      if (turno && extraordinariosPorTurno[turno]) {
        extraordinariosPorTurno[turno].push({ nticket: t.nticket, importeTotal: t.importeTotal });
      }
    }

    // Texto corto por reglas simples: venta(s) extraordinaria(s) + comparación
    // contra el promedio histórico del mismo turno/sucursal.
    function explicacion(turno, datos) {
      if (datos.ticketsSet.size === 0) return 'Sin actividad registrada en este turno.';

      const frases = [];
      const extra = extraordinariosPorTurno[turno];
      if (extra.length > 0) {
        const mayor = extra.reduce((m, x) => (x.importeTotal > m.importeTotal ? x : m), extra[0]);
        frases.push(
          extra.length === 1
            ? `Venta extraordinaria detectada: ticket #${mayor.nticket} por $${mayor.importeTotal.toFixed(2)}.`
            : `${extra.length} ventas extraordinarias detectadas (mayor: ticket #${mayor.nticket} por $${mayor.importeTotal.toFixed(2)}).`
        );
      }

      const promedio = promedioPorTurno[turno];
      if (promedio && promedio > 0) {
        const delta = ((datos.ingreso - promedio) / promedio) * 100;
        if (delta > 20)        frases.push(`Turno por arriba del promedio habitual (+${delta.toFixed(0)}%).`);
        else if (delta < -20)  frases.push(`Turno por debajo del promedio habitual (${delta.toFixed(0)}%).`);
        else                   frases.push('Turno dentro del comportamiento habitual, flujo regular de clientes.');
      }

      return frases.length ? frases.join(' ') : 'Flujo regular de clientes en este turno.';
    }

    const salida = {};
    let totalIngreso = 0;
    for (const turno of ['T1', 'T2', 'T3']) {
      const d = turnos[turno];
      totalIngreso += d.ingreso;
      salida[turno] = {
        ingreso:          d.ingreso,
        sdp:              d.sdp,
        sda:              { monto: d.sdaMonto, cantidad: d.sdaCantidad },
        ti24h:            d.ti24h,
        ticketsGenerados: d.ticketsSet.size,
        explicacion:      explicacion(turno, d),
      };
    }

    const diaSemana = rango.$gte
      .toLocaleDateString('es-MX', { weekday: 'long', timeZone: 'UTC' })
      .toUpperCase();
    const fechaFmt = rango.$gte
      .toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

    res.json({
      ok: true,
      sucursal,
      fecha: fechaFmt,
      diaSemana,
      turnos: salida,
      totalIngreso,
    });
  } catch (err) {
    console.error('[material] corte-turno:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/material/ajustes?sucursal=&fecha= ─────────────────────────
// Historial de ajustes por error de impresión aplicados ese día.
router.get('/material/ajustes', requireAuth, async (req, res) => {
  try {
    const { sucursal, fecha } = req.query;
    if (sucursal && sucursal !== 'todas' && !(await sucursalPermitida(req.session.usuario, sucursal)))
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esa sucursal.' });
    if ((!sucursal || sucursal === 'todas') && req.session.usuario.cargo !== 'admin')
      return res.status(403).json({ ok: false, error: 'Selecciona una sucursal.' });
    const match = { ...filtroSucursal(sucursal) };
    if (fecha) match.fecha = rangoDiaMX(fecha);

    const ajustes = await AjusteTicket.find(match).sort({ fecha: -1 }).lean();
    const totalAjustes = ajustes.reduce((s, a) => s + a.montoDescontado, 0);

    res.json({ ok: true, ajustes, totalAjustes });
  } catch (err) {
    console.error('[material] ajustes:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /api/material/ajuste-ticket/:id ──────────────────────────────
// Elimina un ajuste aplicado por error o porque el caso se canceló.
router.delete('/material/ajuste-ticket/:id', soloAdmin, async (req, res) => {
  try {
    const ajusteActual = await AjusteTicket.findById(req.params.id).select('sucursal').lean();
    if (!ajusteActual) return res.status(404).json({ ok: false, error: 'Ajuste no encontrado' });
    if (!(await sucursalPermitida(req.session.usuario, ajusteActual.sucursal)))
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esa sucursal.' });

    const ajuste = await AjusteTicket.findByIdAndDelete(req.params.id);
    if (!ajuste) return res.status(404).json({ ok: false, error: 'Ajuste no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[material] eliminar ajuste-ticket:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
