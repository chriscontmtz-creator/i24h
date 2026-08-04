import { Router }   from 'express';
import { readFile } from 'fs/promises';
import path          from 'path';
import { fileURLToPath } from 'url';
import Ticket            from '../models/Ticket.js';
import Producto          from '../models/Producto.js';
import Usuario           from '../models/Usuario.js';
import CorteCaja         from '../models/CorteCaja.js';
import Revision          from '../models/Revision.js';
import { requireEmpleado, sesionActual } from '../middlewares/auth.js';
import { sucursalesDeUsuario } from '../utils/sucursales.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUCURSALES = [
  'Simón Bolívar', 'Insurgentes', 'Antígona', 'Lincoln Oxxo',
  'Lincoln 2', 'Ruiz Cortines', 'Rodas', 'Cuauhtémoc', 'Ordóñez',
];

// Clave interna usada al hacer sync (sin tildes ni espacios)
const SUCURSAL_DB = {
  'Simón Bolívar': 'SimonBolivar',
  'Insurgentes':   'Insurgentes',
  'Antígona':      'Antigona',
  'Lincoln Oxxo':  'LincolnOxxo',
  'Lincoln 2':     'LincolnDos',
  'Ruiz Cortines': 'RuizCortines',
  'Rodas':         'Rodas',
  'Cuauhtémoc':    'Cuauhtemoc',
  'Ordóñez':       'Ordonez',
};

// Solo estas 9 claves cuentan como sucursal real — en Mongo quedaron restos
// de pruebas del piloto de sync bajo 'TestSucursal' y 'Simón Bolívar' (con
// acento, en vez de la clave 'SimonBolivar') con exactamente el mismo rango
// de fechas que los datos reales: duplicados del mismo snapshot, no
// sucursales aparte. "Todas las sucursales" debe acotarse a estas 9 claves
// o esa basura se vuelve a sumar y triplica/infla los números.
const SUCURSALES_REALES_DB = Object.values(SUCURSAL_DB);

const TIPO_CAT = {
  1: 'Internet',
  2: 'Prepago',
  5: 'Servicios',
  6: 'Copiado',
};

// Solo estos tipos cuentan en totales (4=interno $0, 16=descuentos/ajustes negativos)
const TIPOS_VALIDOS = [1, 2, 5, 6];

// Turno a partir de CorteCaja.operador1 ("Turno1", "Turno 2"…) — mismo patrón
// que revisiones.js:11-14 y material.js.
function turnoCorto(operador) {
  const m = (operador || '').match(/Turno\s*(\d)/i);
  return m ? 'T' + m[1] : null;
}

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

function rangoPeriodo(periodo) {
  // Los cortes se guardan en midnight UTC del día que se sincronizó.
  // México es UTC-6, así que después de las 6pm México el reloj UTC ya es el día siguiente.
  // Usamos la fecha local de México para calcular los rangos correctamente.
  const MX_OFFSET = 6 * 60 * 60 * 1000; // UTC-6 fijo (CST)
  const hoy = new Date(Date.now() - MX_OFFSET); // "ahora" en México como si fuera UTC
  const año = hoy.getUTCFullYear();
  const mes = hoy.getUTCMonth(); // 0-indexed

  const inicioDia = d => { const r = new Date(d); r.setUTCHours(0, 0, 0, 0);       return r; };
  const finDia    = d => { const r = new Date(d); r.setUTCHours(23, 59, 59, 999);  return r; };
  const capitalizar = s => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtCorto  = d => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  let fi, ff, label;

  switch (periodo) {
    case 'hoy':
      fi    = inicioDia(hoy);
      ff    = finDia(hoy);
      label = 'Hoy';
      break;

    case 'semana':
      // 7 días completos incluyendo hoy (hoy = día 7)
      fi    = inicioDia(hoy); fi.setUTCDate(hoy.getUTCDate() - 6);
      ff    = finDia(hoy);
      label = 'Últimos 7 días';
      break;

    case 'mes-pasado':
      fi    = new Date(Date.UTC(año, mes - 1, 1));
      ff    = new Date(Date.UTC(año, mes,     0, 23, 59, 59, 999));
      label = capitalizar(fi.toLocaleString('es-MX', { month: 'long', year: 'numeric' }));
      break;

    case 'semestre':
      fi    = inicioDia(hoy); fi.setUTCMonth(mes - 6);
      ff    = finDia(hoy);
      label = 'Últimos 6 meses';
      break;

    default: // mes actual
      fi    = new Date(Date.UTC(año, mes,     1));
      ff    = new Date(Date.UTC(año, mes + 1, 0, 23, 59, 59, 999));
      label = capitalizar(hoy.toLocaleString('es-MX', { month: 'long', year: 'numeric' }));
  }

  // Subtítulo con el rango exacto visible en el header
  const labelFechas = `${fmtCorto(fi)} – ${fmtCorto(ff)}`;

  return { fi, ff, label, labelFechas };
}

// ── GET /dashboard ──────────────────────────────────────────────
router.get('/', sesionActual, requireEmpleado, async (req, res) => {
  try {
    const usuarioSesion = req.session.usuario;
    const verTodasLasSucursales = usuarioSesion.cargo === 'admin';
    const sucursalesPermitidas  = await sucursalesDeUsuario(usuarioSesion);

    // Solo admin puede pedir "todas" o cualquier sucursal fuera de las
    // suyas — cualquier otro cargo se recorta a la primera que tenga
    // asignada (o a un filtro imposible si no tiene ninguna).
    let sucursalDisplay = req.query.sucursal || 'todas';
    const sinSucursalesAsignadas = !verTodasLasSucursales && sucursalesPermitidas.length === 0;
    if (!verTodasLasSucursales) {
      if (sinSucursalesAsignadas) {
        sucursalDisplay = '__sin_sucursal_asignada__';
      } else if (sucursalDisplay === 'todas' || !sucursalesPermitidas.includes(sucursalDisplay)) {
        sucursalDisplay = sucursalesPermitidas[0];
      }
    }

    const periodo         = req.query.periodo  || 'semestre';
    const turnoFiltro     = req.query.turno    || 'todos';
    const diaFiltro       = req.query.dia      || 'todos';

    let { fi, ff, label: labelPeriodo, labelFechas } = rangoPeriodo(periodo);

    // Calcular los 7 días de la semana (Vie→Jue) usando fecha México
    const MX_OFFSET = 6 * 60 * 60 * 1000;
    const hoyMx = new Date(Date.now() - MX_OFFSET);
    const diasDesdeViernes = (hoyMx.getUTCDay() - 5 + 7) % 7;
    const viernesBase = new Date(hoyMx);
    viernesBase.setUTCDate(hoyMx.getUTCDate() - diasDesdeViernes);
    viernesBase.setUTCHours(0, 0, 0, 0);
    const NOMBRES_DIA = ['Vie', 'Sáb', 'Dom', 'Lun', 'Mar', 'Mié', 'Jue'];
    const diasSemana = NOMBRES_DIA.map((nombre, i) => {
      const d = new Date(viernesBase);
      d.setUTCDate(viernesBase.getUTCDate() + i);
      const fechaStr = d.toISOString().split('T')[0];
      return { nombre, fecha: fechaStr, activo: diaFiltro === fechaStr };
    });

    // Si es semana y hay día específico, acota el rango a ese día
    if (periodo === 'semana' && diaFiltro !== 'todos') {
      fi = new Date(diaFiltro + 'T00:00:00.000Z');
      ff = new Date(diaFiltro + 'T23:59:59.999Z');
      labelFechas = fi.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    }

    // Siempre filtramos tickets por ncaja (no por fecha directa).
    // Así "hoy" = cajas abiertas ese día (T1+T2+T3 del día operativo 5AM-5AM),
    // excluyendo automáticamente el T3 del día anterior que cierra a las 5 AM.
    const matchCortes = { fecha: { $gte: fi, $lte: ff } };
    matchCortes.sucursal = sucursalDisplay !== 'todas'
      ? (SUCURSAL_DB[sucursalDisplay] || sucursalDisplay)
      : { $in: SUCURSALES_REALES_DB };
    if (turnoFiltro !== 'todos') matchCortes.operador1 = turnoFiltro;

    const cortesBase = await CorteCaja.find(matchCortes).select('ncaja').lean();
    const ncajasBase = cortesBase.map(c => c.ncaja);

    // El filtro de sucursal se repite aquí a propósito (no basta con el ncaja
    // de arriba): ncaja solo es único DENTRO de una sucursal, así que sin
    // esto un mismo número de caja podría mezclar tickets de sucursales
    // distintas (mismo bug ya documentado en revisiones.js).
    const matchBase = {
      ncaja:    ncajasBase.length > 0 ? { $in: ncajasBase } : { $in: [-1] },
      anulado:  false,
      sucursal: matchCortes.sucursal,
    };

    const [
      ventaAgg,
      ventaDiariaAgg,
      topProductosAgg,
      ventaCategoriaAgg,
      empleadosCount,
      revisionesPend,
      productosRaw,
    ] = await Promise.all([
      // Total ventas del período (solo tipos 1,2,5,6 — excluye tipo 4 interno y tipo 16 ajustes)
      Ticket.aggregate([
        { $match: matchBase },
        { $project: {
          fecha: 1,
          importeReal: {
            $sum: {
              $map: {
                input: { $filter: { input: '$lineas', as: 'l', cond: { $in: ['$$l.tipo', TIPOS_VALIDOS] } } },
                as: 'l',
                in: '$$l.importe',
              },
            },
          },
        }},
        { $group: { _id: null, total: { $sum: '$importeReal' }, count: { $sum: 1 } } },
      ]),
      // Ventas agrupadas por día → gráfica (solo tipos válidos)
      Ticket.aggregate([
        { $match: matchBase },
        { $project: {
          fecha: 1,
          importeReal: {
            $sum: {
              $map: {
                input: { $filter: { input: '$lineas', as: 'l', cond: { $in: ['$$l.tipo', TIPOS_VALIDOS] } } },
                as: 'l',
                in: '$$l.importe',
              },
            },
          },
        }},
        { $group: {
          _id:   { $dateToString: { format: '%Y-%m-%d', date: '$fecha', timezone: '-06:00' } },
          total: { $sum: '$importeReal' },
        }},
        { $sort: { _id: 1 } },
      ]),
      // Top servicios/productos (tipo 5 y 6)
      Ticket.aggregate([
        { $match: matchBase },
        { $unwind: '$lineas' },
        { $match: { 'lineas.tipo': { $in: [5, 6] } } },
        { $group: {
          _id:      '$lineas.detalle',
          unidades: { $sum: '$lineas.cantidad' },
          monto:    { $sum: '$lineas.importe' },
        }},
        { $sort: { monto: -1 } },
        { $limit: 8 },
      ]),
      // Ventas por categoría (por tipo de línea, excluyendo descuentos y operador)
      Ticket.aggregate([
        { $match: matchBase },
        { $unwind: '$lineas' },
        { $match: { 'lineas.tipo': { $in: [1, 2, 5, 6] } } },
        { $group: {
          _id:   '$lineas.tipo',
          total: { $sum: '$lineas.importe' },
        }},
        { $sort: { total: -1 } },
      ]),
      Usuario.countDocuments({ cargo: { $ne: 'cliente' }, activo: true }),
      Revision.find({
        sucursal: matchBase.sucursal,
        estado:   { $in: ['diferencia_cobrable', 'pendiente'] },
      }).sort({ fecha: -1 }).limit(5).lean(),
      // Stock de productos (snapshot, no depende del período)
      Producto.find({
        sucursal: matchBase.sucursal,
        nombre:   { $not: /^Nuevo Producto/ },
      }).sort({ stock: 1, nombre: 1 }).lean(),
    ]);

    const ventaTotal     = ventaAgg[0]?.total || 0;
    const totalTickets   = ventaAgg[0]?.count  || 0;
    const maxVenta       = ventaDiariaAgg.reduce((m, d) => Math.max(m, d.total), 1);
    const ventaCatMax    = ventaCategoriaAgg[0]?.total || 1;

    // Procesar stock
    const stockAgotados = productosRaw.filter(p => p.stock <= 0);
    const stockBajos    = productosRaw.filter(p => p.stock > 0 && p.stock <= p.minimo);
    const stockOk       = productosRaw.filter(p => p.stock > p.minimo);
    const stockProductos = [
      ...stockAgotados.map(p => ({
        nombre: p.nombre, precio: p.precio, stock: p.stock, minimo: p.minimo,
        estadoLabel: 'Agotado', estadoClase: 'peligro', rowClase: 'dash-inv-row--agotado',
      })),
      ...stockBajos.map(p => ({
        nombre: p.nombre, precio: p.precio, stock: p.stock, minimo: p.minimo,
        estadoLabel: 'Bajo', estadoClase: 'alerta', rowClase: 'dash-inv-row--bajo',
      })),
      ...stockOk.map(p => ({
        nombre: p.nombre, precio: p.precio, stock: p.stock, minimo: p.minimo,
        estadoLabel: 'OK', estadoClase: 'exito', rowClase: '',
      })),
    ];

    // Alertas de stock desde datos/alertas.json
    let alertasStock = [];
    try {
      const raw = await readFile(path.join(__dirname, '../../datos/alertas.json'), 'utf-8');
      alertasStock = JSON.parse(raw);
      if (sucursalDisplay !== 'todas') alertasStock = alertasStock.filter(a => a.sucursal === sucursalDisplay);
    } catch (_) {}

    // Turno data desde CorteCaja
    let turnosData = null;
    try {
      const matchTurnos = {
        cerrada:  true,
        fecha:    { $gte: fi, $lte: ff },
        sucursal: matchBase.sucursal,
      };
      const turnoAgg = await CorteCaja.aggregate([
        { $match: matchTurnos },
        { $group: { _id: '$operador1', promedio: { $avg: '$ingreso' }, total: { $sum: '$ingreso' }, count: { $sum: 1 } } },
      ]);
      // Se asigna por el turno REAL de operador1 (regex "Turno N" -> TN), no
      // por ranking de total — antes T1/T2/T3 salían por quién vendió más.
      const porTurno = id => turnoAgg.find(a => turnoCorto(a._id) === id);
      const t1turno = porTurno('T1'), t2turno = porTurno('T2'), t3turno = porTurno('T3');
      if (turnoAgg.length > 0) {
        turnosData = {
          T1: t1turno ? { label: t1turno._id, promedio: MXN.format(t1turno.promedio), total: MXN.format(t1turno.total), count: t1turno.count } : null,
          T2: t2turno ? { label: t2turno._id, promedio: MXN.format(t2turno.promedio), total: MXN.format(t2turno.total), count: t2turno.count } : null,
          T3: t3turno ? { label: t3turno._id, promedio: MXN.format(t3turno.promedio), total: MXN.format(t3turno.total), count: t3turno.count } : null,
        };
      }
    } catch (_) {}

    // JSON para Chart.js
    const dashJson = JSON.stringify({
      ventaDiaria: ventaDiariaAgg.map(d => ({ fecha: d._id, total: d.total })),
      maxVenta,
    });

    res.render('dashboard', {
      titulo:          'Dashboard',
      estiloExtra:     'css/dashboard.css',
      scriptPrincipal: 'js/dashboard.js',
      usuario:         req.session.usuario,
      esAdmin:         ['admin', 'coordinador'].includes(req.session.usuario.cargo),
      verTodasLasSucursales: verTodasLasSucursales,
      sinSucursalesAsignadas,
      sucursalActiva:  sucursalDisplay,
      periodoActivo:   periodo,
      turnoActivo:     turnoFiltro,
      sucursales:      (verTodasLasSucursales ? SUCURSALES : sucursalesPermitidas)
        .map(s => ({ nombre: s, activa: s === sucursalDisplay })),
      labelPeriodo,
      labelFechas,
      // período booleans para <select> selected
      periodoHoy:       periodo === 'hoy',
      periodoSemana:    periodo === 'semana',
      periodoMes:       periodo === 'mes',
      periodoMesPasado: periodo === 'mes-pasado',
      periodoSemestre:  periodo === 'semestre',
      // turno booleans
      turnoTodos: turnoFiltro === 'todos',
      turnoT1:    turnoFiltro === 'Turno1',
      turnoT2:    turnoFiltro === 'Turno2',
      turnoT3:    turnoFiltro === 'Turno3',
      // días de semana
      diasSemana,
      diaFiltro,
      diaActivo:  diaFiltro !== 'todos',
      // KPIs
      ventaTotalFmt:   MXN.format(ventaTotal),
      totalTickets,
      empleadosCount,
      alertasStock:    alertasStock.slice(0, 6),
      hayAlertas:      alertasStock.length > 0,
      stockProductos,
      hayStock:        stockProductos.length > 0,
      stockResumen: {
        total:    productosRaw.length,
        agotados: stockAgotados.length,
        bajos:    stockBajos.length,
        ok:       stockOk.length,
      },
      topProductos:    topProductosAgg.map(p => ({
        nombre:   p._id,
        unidades: p.unidades,
        montoFmt: MXN.format(p.monto),
      })),
      hayProductos:    topProductosAgg.length > 0,
      ventaCategoria:  ventaCategoriaAgg.map(c => ({
        categoria: TIPO_CAT[c._id] || `Tipo ${c._id}`,
        totalFmt:  MXN.format(c.total),
        barWidth:  Math.round((c.total / ventaCatMax) * 100),
      })),
      hayCategorias:   ventaCategoriaAgg.length > 0,
      turnosData,
      hayTurnos:       !!turnosData,
      revisionesPend:  revisionesPend.map(r => ({
        ...r,
        esCobrable: r.estado === 'diferencia_cobrable',
      })),
      hayRevisiones:   revisionesPend.length > 0,
      dashJson,
      fechaSync:       new Date().toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    });
  } catch (err) {
    console.error('Error en /dashboard:', err);
    res.status(500).send('Error al cargar el dashboard');
  }
});

export default router;
