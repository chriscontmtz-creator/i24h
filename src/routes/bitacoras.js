import { Router } from 'express';
import BitacoraTurno  from '../models/BitacoraTurno.js';
import SnapshotCorte  from '../models/SnapshotCorte.js';
import Producto       from '../models/Producto.js';
import { requireEmpleado, requireAdmin, sesionActual } from '../middlewares/auth.js';

// Mapeo nombre display → clave en MongoDB (igual que sync.js)
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

// Rango del día calendario en hora México (UTC-6) — mismo patrón que material.js:37-50.
// No usar el patrón de revisiones.js (no resta el offset MX, es inconsistente).
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

// Resuelve "Turno 1 — 07:00 a 15:00" → "T1" — mismo patrón que revisiones.js:11-14.
function turnoCorto(t) {
  const m = (t || '').match(/Turno\s*(\d)/i);
  return m ? 'T' + m[1] : '?';
}

const router = Router();

// POST /api/bitacora/guardar
router.post('/bitacora/guardar', sesionActual, requireEmpleado, async (req, res) => {
  try {
    const { sucursal, turno, fecha, productos, resumen, responsable } = req.body;

    if (!sucursal || !turno || !fecha || !Array.isArray(productos)) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const fechaDate = new Date(fecha);
    if (isNaN(fechaDate)) return res.status(400).json({ error: 'Fecha inválida' });

    const doc = new BitacoraTurno({
      sucursal,
      turno,
      fecha: fechaDate,
      responsable: responsable || req.session?.usuario?.nombre || '',
      fechaCierre: new Date(),
      resumen: resumen || {},
      productos,
    });

    await doc.save();
    res.json({ ok: true, id: doc._id });
  } catch (err) {
    console.error('[bitacora] guardar:', err.message);
    res.status(500).json({ error: 'Error al guardar bitácora' });
  }
});

// GET /api/bitacora/lista?sucursal=X&limit=20&skip=0
router.get('/bitacora/lista', sesionActual, requireEmpleado, requireAdmin, async (req, res) => {
  try {
    const { sucursal, limit = 20, skip = 0 } = req.query;
    const filtro = {};
    if (sucursal && sucursal !== 'todas') filtro.sucursal = sucursal;

    const [docs, total] = await Promise.all([
      BitacoraTurno.find(filtro)
        .sort({ fecha: -1, fechaCierre: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .select('-productos')
        .lean(),
      BitacoraTurno.countDocuments(filtro),
    ]);

    res.json({ ok: true, docs, total });
  } catch (err) {
    console.error('[bitacora] lista:', err.message);
    res.status(500).json({ error: 'Error al obtener lista' });
  }
});

// GET /api/bitacora/estado-turnos?fecha=YYYY-MM-DD
// Para las 9 sucursales, indica si ya existe bitácora de cada turno (T1/T2/T3)
// en la fecha dada (día calendario en hora MX). Un solo query + agrupación en
// memoria en vez de 27 queries individuales.
router.get('/bitacora/estado-turnos', sesionActual, requireEmpleado, requireAdmin, async (req, res) => {
  try {
    const fecha = req.query.fecha || null;
    const rango = rangoDiaMX(fecha);

    const docs = await BitacoraTurno.find({ fecha: rango })
      .select('sucursal turno')
      .lean();

    const presentes = new Set(
      docs.map(d => `${d.sucursal}|${turnoCorto(d.turno)}`)
    );

    const sucursales = Object.keys(SUCURSAL_DB);
    const filas = sucursales.map(sucursal => ({
      sucursal,
      turnos: {
        T1: presentes.has(`${sucursal}|T1`),
        T2: presentes.has(`${sucursal}|T2`),
        T3: presentes.has(`${sucursal}|T3`),
      },
    }));

    const fechaUsada = fecha || (() => {
      const mx = new Date(Date.now() - 6 * 60 * 60 * 1000);
      return mx.toISOString().split('T')[0];
    })();

    res.json({ ok: true, fecha: fechaUsada, filas });
  } catch (err) {
    console.error('[bitacora] estado-turnos:', err.message);
    res.status(500).json({ error: 'Error al obtener estado de turnos' });
  }
});

// GET /api/bitacora/snapshot-corte?sucursal=X
// Lee stock actual de Producto (actualizado por sync.js tras cada corte).
// Fallback a SnapshotCorte si no hay productos en la colección.
router.get('/bitacora/snapshot-corte', sesionActual, requireEmpleado, async (req, res) => {
  try {
    const { sucursal } = req.query;
    if (!sucursal) return res.status(400).json({ error: 'Falta sucursal' });

    const dbKey = SUCURSAL_DB[sucursal] || sucursal;

    const prods = await Producto.find(
      { sucursal: dbKey, nombre: { $not: /^Nuevo Producto/ } }
    ).select('nombre stock').lean();

    if (prods.length > 0) {
      return res.json({
        ok:       true,
        snapshot: {
          sucursal,
          turnoQueEntrega: '—',
          turnoQueRecibe:  '—',
          fechaCorte:      new Date(),
          productos:       prods.map(p => ({ nombre: p.nombre, stock: p.stock ?? 0 })),
        },
      });
    }

    // Fallback: usar snapshot guardado
    const snap = await SnapshotCorte.findOne({ sucursal }).sort({ fechaCorte: -1 }).lean();
    if (!snap) return res.json({ ok: false, mensaje: 'Sin snapshot disponible' });
    res.json({ ok: true, snapshot: snap });

  } catch (err) {
    console.error('[bitacora] snapshot-corte:', err.message);
    res.status(500).json({ error: 'Error al obtener snapshot' });
  }
});

// GET /api/bitacora/:id
router.get('/bitacora/:id', sesionActual, requireEmpleado, requireAdmin, async (req, res) => {
  try {
    const doc = await BitacoraTurno.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true, doc });
  } catch (err) {
    console.error('[bitacora] detalle:', err.message);
    res.status(500).json({ error: 'Error al obtener detalle' });
  }
});

export default router;
