import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { leer } from '../utils/data.js';
import { sucursalConectada, sucursalPermitida, sucursalesDeUsuario, TODAS_SUCURSALES } from '../utils/sucursales.js';
import Ticket     from '../models/Ticket.js';
import CorteCaja  from '../models/CorteCaja.js';

const router = Router();

const VNT_MULT = { hoy: 1, '7': 7, '15': 15, '30': 30 };
const CATS     = ['Novedades', 'Papelería', 'Snack'];

// ── Mapeo nombre display → clave MongoDB (igual que dashboard.js/bitacoras.js) ──
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
const DB_A_DISPLAY = Object.fromEntries(Object.entries(SUCURSAL_DB).map(([k, v]) => [v, k]));

// Solo estas 9 claves son sucursales reales — evita que restos de pruebas
// del sync (ver dashboard.js) se cuelen en el conteo de "todas".
const SUCURSALES_REALES_DB = Object.values(SUCURSAL_DB);

// Ticket con importeTotal > $300 = venta extraordinaria — mismo umbral que ya
// usa material.js (tab "Corte por turno") para su "explicación" de turno.
const UMBRAL_EXTRAORDINARIA = 300;
const TIPOS_VALIDOS = [1, 2, 5, 6]; // excluye tipo 4 (interno $0) y 16 (ajustes)

function turnoCorto(operador) {
  const m = (operador || '').match(/Turno\s*(\d)/i);
  return m ? 'T' + m[1] : null;
}

// Rango de fechas en horario de México (mismo patrón que dashboard.js:
// UTC-6 fijo para calcular "hoy" correctamente sin importar dónde corra el server).
function rangoVentas(periodo) {
  const MX_OFFSET = 6 * 60 * 60 * 1000;
  const hoyMx = new Date(Date.now() - MX_OFFSET);
  const dias  = { hoy: 1, '7': 7, '15': 15, '30': 30 }[periodo] || 7;
  const ff = new Date(Date.UTC(hoyMx.getUTCFullYear(), hoyMx.getUTCMonth(), hoyMx.getUTCDate(), 23, 59, 59, 999));
  const fi = new Date(Date.UTC(hoyMx.getUTCFullYear(), hoyMx.getUTCMonth(), hoyMx.getUTCDate() - (dias - 1), 0, 0, 0, 0));
  return { fi, ff };
}

// Lee los JSON cada vez que llega una petición (sin reiniciar el servidor)
function getVentas()   { return leer('ventas.json');   }
function getProductos(){ return leer('productos.json'); }
function getAlertas()  { return leer('alertas.json');  }

// GET /api/ventas?sucursal=&periodo=
router.get('/ventas', requireAuth, async (req, res) => {
  const { sucursal = 'todas', periodo = '7' } = req.query;
  const mult = VNT_MULT[periodo] || 7;

  // Scoping por usuario (BUG-03): admin ve las 9; cualquier otro cargo solo
  // las sucursales que tiene asignadas — mismo criterio que Dashboard y
  // /ventas/extraordinarias. Antes este endpoint mock devolvía las 9 a
  // cualquier empleado logueado (lider/encargado incluidos), contradiciendo
  // la regla de sucursales.js. Se filtra por nombre display (coincide con
  // Usuario.sucursales y con el campo `nombre` de ventas.json).
  const permitidas = await sucursalesDeUsuario(req.session.usuario);

  const data       = getVentas();
  const sucursales = (data.sucursales || []).filter(s => permitidas.includes(s.nombre));
  const filtradas  = sucursal === 'todas'
    ? sucursales
    : sucursales.filter(s => s.id === sucursal);

  const desglose = filtradas.map(s => {
    const conectada = sucursalConectada(s.nombre);
    const categorias = {};
    let totalSuc = 0;
    CATS.forEach(cat => {
      const val = conectada ? Math.round((s[cat] || 0) * mult) : 0;
      categorias[cat] = val;
      totalSuc += val;
    });
    return { id: s.id, nombre: s.nombre, total: totalSuc, categorias, delta: conectada ? (s.delta || 0) : 0 };
  });

  const totalGeneral  = desglose.reduce((a, s) => a + s.total, 0);
  const topSucursal   = [...desglose].sort((a, b) => b.total - a.total)[0];
  const conectadas    = desglose.filter(s => sucursalConectada(s.nombre));
  const deltaPromedio = Math.round(
    conectadas.reduce((a, s) => a + s.delta, 0) / (conectadas.length || 1) * 10
  ) / 10;

  const porCategoria = {};
  CATS.forEach(cat => {
    porCategoria[cat] = desglose.reduce((a, s) => a + (s.categorias[cat] || 0), 0);
  });
  const topCategoria = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0];

  res.json({
    periodo, sucursal, totalGeneral,
    topSucursal:  topSucursal  ? { id: topSucursal.id, nombre: topSucursal.nombre, total: topSucursal.total } : null,
    topCategoria: topCategoria ? { nombre: topCategoria[0], total: topCategoria[1] } : null,
    deltaPromedio, desglose, porCategoria,
  });
});

// GET /api/ventas/top-productos?categoria=&periodo=
router.get('/ventas/top-productos', requireAuth, async (req, res) => {
  const { categoria = 'todas', periodo = '7' } = req.query;
  const mult = VNT_MULT[periodo] || 7;

  // Scoping por usuario (BUG-03) — solo sucursales asignadas (admin = las 9).
  const permitidas = await sucursalesDeUsuario(req.session.usuario);
  const lista = getProductos().filter(p => sucursalConectada(p.sucursal) && permitidas.includes(p.sucursal));
  const filtrados = categoria === 'todas' ? lista : lista.filter(p => p.categoria === categoria);

  const resultado = filtrados.slice(0, 10).map(p => ({
    nombre:    p.nombre,
    categoria: p.categoria,
    sucursal:  p.sucursal,
    unidades:  Math.round(p.unidades * mult / 7),
    venta:     Math.round(p.unidades * mult / 7 * p.precio),
  }));

  res.json(resultado);
});

// GET /api/ventas/alertas
router.get('/ventas/alertas', requireAuth, async (req, res) => {
  // Scoping por usuario (BUG-03) — solo sucursales asignadas (admin = las 9).
  const permitidas = await sucursalesDeUsuario(req.session.usuario);
  res.json(getAlertas().filter(a => sucursalConectada(a.sucursal) && permitidas.includes(a.sucursal)));
});

// GET /api/ventas/extraordinarias?sucursal=&periodo=
// Ventas reales (Mongo, no mock) con importeTotal > $300 — a diferencia del
// resto de este archivo, que trabaja sobre datos/ventas.json. Compara cuántas
// hay por sucursal y trae el detalle completo del ticket (qué se llevó).
router.get('/ventas/extraordinarias', requireAuth, async (req, res) => {
  try {
    const { sucursal = 'todas', periodo = '7' } = req.query;

    if (sucursal === 'todas') {
      // Mismo criterio que requireAdmin (admin.js/middlewares) — el selector
      // de sucursal de Ventas ya ofrece "todas" a admin y coordinador por
      // igual, sin distinguirlos (a diferencia de Dashboard).
      if (!['admin', 'coordinador'].includes(req.session.usuario.cargo))
        return res.status(403).json({ error: 'No tienes acceso a todas las sucursales.' });
    } else if (!(await sucursalPermitida(req.session.usuario, sucursal))) {
      return res.status(403).json({ error: 'No tienes acceso a esa sucursal.' });
    }

    const { fi, ff } = rangoVentas(periodo);

    const sucursalesAConsultar = sucursal === 'todas'
      ? TODAS_SUCURSALES.filter(sucursalConectada)
      : (sucursalConectada(sucursal) ? [sucursal] : []);
    const dbKeys = sucursalesAConsultar.map(s => SUCURSAL_DB[s] || s).filter(k => SUCURSALES_REALES_DB.includes(k));

    const porSucursal = TODAS_SUCURSALES.map(nombre => ({ nombre, count: 0 }));

    if (!dbKeys.length) {
      return res.json({
        periodo, sucursal, umbral: UMBRAL_EXTRAORDINARIA,
        total: 0, porSucursal, porTurno: { T1: 0, T2: 0, T3: 0 }, tickets: [],
      });
    }

    const [tickets, cortes] = await Promise.all([
      Ticket.find({
        sucursal:     { $in: dbKeys },
        fecha:        { $gte: fi, $lte: ff },
        anulado:      false,
        importeTotal: { $gt: UMBRAL_EXTRAORDINARIA },
      }).select('nticket fecha ncaja importeTotal lineas sucursal').sort({ importeTotal: -1 }).lean(),
      CorteCaja.find({ sucursal: { $in: dbKeys }, fecha: { $gte: fi, $lte: ff } })
        .select('ncaja sucursal operador1').lean(),
    ]);

    // ncaja solo es único DENTRO de una sucursal (mismo gotcha documentado en
    // dashboard.js/revisiones.js) — la clave del mapa siempre lleva sucursal+ncaja.
    const turnoPorCaja = {};
    for (const c of cortes) turnoPorCaja[c.sucursal + '_' + c.ncaja] = turnoCorto(c.operador1);

    const conteoPorSucursal = {};
    const porTurno = { T1: 0, T2: 0, T3: 0 };

    const ticketsOut = tickets.map(t => {
      const nombreSucursal = DB_A_DISPLAY[t.sucursal] || t.sucursal;
      const turno = turnoPorCaja[t.sucursal + '_' + t.ncaja] || null;

      conteoPorSucursal[nombreSucursal] = (conteoPorSucursal[nombreSucursal] || 0) + 1;
      if (turno && porTurno[turno] !== undefined) porTurno[turno]++;

      return {
        id:           String(t._id),
        nticket:      t.nticket,
        sucursal:     nombreSucursal,
        turno,
        fecha:        t.fecha,
        importeTotal: t.importeTotal,
        lineas: (t.lineas || [])
          .filter(l => TIPOS_VALIDOS.includes(l.tipo))
          .map(l => ({ detalle: l.detalle, cantidad: l.cantidad, importe: l.importe })),
      };
    });

    porSucursal.forEach(s => { s.count = conteoPorSucursal[s.nombre] || 0; });

    res.json({
      periodo, sucursal, umbral: UMBRAL_EXTRAORDINARIA,
      total:    ticketsOut.length,
      porSucursal,
      porTurno,
      tickets:  ticketsOut.slice(0, 30),
    });
  } catch (err) {
    console.error('[ventas] extraordinarias:', err.message);
    res.status(500).json({ error: 'Error al obtener ventas extraordinarias' });
  }
});

export default router;
