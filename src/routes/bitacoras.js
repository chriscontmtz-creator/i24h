import { Router } from 'express';
import BitacoraTurno  from '../models/BitacoraTurno.js';
import SnapshotCorte  from '../models/SnapshotCorte.js';
import Producto       from '../models/Producto.js';
import { requireEmpleado, sesionActual } from '../middlewares/auth.js';

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
router.get('/bitacora/lista', sesionActual, requireEmpleado, async (req, res) => {
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
router.get('/bitacora/:id', sesionActual, requireEmpleado, async (req, res) => {
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
