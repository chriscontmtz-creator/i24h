import { Router } from 'express';
import Horario  from '../models/Horario.js';
import Usuario  from '../models/Usuario.js';
import { requireAuth, requireAdmin, requireEmpleado, sesionActual } from '../middlewares/auth.js';

const router = Router();

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
const POPULATE_OPTS = [
  { path: 'turnos.T1.empleados', model: 'Usuario', select: 'nombre cargo sucursales' },
  { path: 'turnos.T2.empleados', model: 'Usuario', select: 'nombre cargo sucursales' },
  { path: 'turnos.T3.empleados', model: 'Usuario', select: 'nombre cargo sucursales' },
];

// ── Utilidades ──────────────────────────────────────────────────

function isoWeekStr(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

// Convierte array de celdas [{dia, empleados, ...}] a array fijo de 7 posiciones
function normalizarTurno(celdas) {
  const arr = Array.from({ length: 7 }, (_, i) => ({
    dia: i, empleados: [], estado: 'vacio', indicacion: '',
  }));
  (celdas || []).forEach(c => {
    if (c.dia >= 0 && c.dia <= 6) arr[c.dia] = c;
  });
  return arr;
}

function normalizarHorario(h) {
  const obj = h.toObject ? h.toObject({ depopulate: false }) : { ...h };
  obj.turnos = {
    T1: normalizarTurno(obj.turnos?.T1),
    T2: normalizarTurno(obj.turnos?.T2),
    T3: normalizarTurno(obj.turnos?.T3),
  };
  return obj;
}

// ── GET /horarios ───────────────────────────────────────────────
// Renderiza la vista principal del módulo
router.get('/', sesionActual, requireEmpleado, async (req, res) => {
  try {
    const semana   = req.query.semana   || isoWeekStr(new Date());
    const sucursal = req.query.sucursal || 'todas';

    const filtro = { semana };
    if (sucursal !== 'todas') filtro.sucursal = sucursal;

    const [horariosRaw, empleados] = await Promise.all([
      Horario.find(filtro)
        .populate(POPULATE_OPTS[0])
        .populate(POPULATE_OPTS[1])
        .populate(POPULATE_OPTS[2])
        .lean(),
      Usuario.find({ cargo: { $ne: 'cliente' }, activo: true })
        .select('_id nombre cargo sucursales')
        .lean(),
    ]);

    // Normaliza los turnos para que siempre tengan 7 entradas
    const horarios = horariosRaw.map(h => {
      ['T1','T2','T3'].forEach(t => {
        const arr = new Array(7).fill(null).map((_, i) => ({
          dia: i, empleados: [], estado: 'vacio', indicacion: '',
        }));
        (h.turnos?.[t] || []).forEach(c => {
          if (c.dia >= 0 && c.dia <= 6) arr[c.dia] = c;
        });
        h.turnos[t] = arr;
      });
      return h;
    });

    // Índice por sucursal para el template HBS + flag de estado
    const horariosPorSucursal = {};
    horarios.forEach(h => {
      horariosPorSucursal[h.sucursal] = { ...h, esPublicado: h.estado === 'publicado' };
    });

    res.render('horarios/index', {
      titulo:          'Horarios',
      estiloExtra:     'css/horarios.css',
      scriptPrincipal: 'js/horarios.js',
      horDataJson:     JSON.stringify({ horarios, empleados, semana, sucursal, sucursales: SUCURSALES }),
      horariosPorSucursal,
      semanaActual:    semana,
      sucursalActiva:  sucursal,
      sucursales:      SUCURSALES,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar horarios');
  }
});

// ── GET /horarios/api/empleados ──────────────────────────────────
// Lista de empleados activos para cargar el roster del editor
router.get('/api/empleados', requireAuth, requireAdmin, async (req, res) => {
  try {
    const empleados = await Usuario.find({ cargo: { $ne: 'cliente' }, activo: true })
      .select('_id nombre cargo sucursales')
      .lean();
    res.json(empleados);
  } catch {
    res.status(500).json({ error: 'Error al obtener empleados' });
  }
});

// ── GET /horarios/api/semana/:semana/:sucursal ───────────────────
// Devuelve el horario de una semana/sucursal específica (con empleados populados)
router.get('/api/semana/:semana/:sucursal', requireAuth, async (req, res) => {
  try {
    const { semana, sucursal } = req.params;

    let horarios;
    if (sucursal === 'todas') {
      horarios = await Horario.find({ semana })
        .populate(POPULATE_OPTS[0])
        .populate(POPULATE_OPTS[1])
        .populate(POPULATE_OPTS[2])
        .lean();
    } else {
      const h = await Horario.findOne({ semana, sucursal })
        .populate(POPULATE_OPTS[0])
        .populate(POPULATE_OPTS[1])
        .populate(POPULATE_OPTS[2])
        .lean();
      horarios = h ? [h] : [];
    }

    // Normaliza turnos
    horarios.forEach(h => {
      ['T1','T2','T3'].forEach(t => {
        const arr = new Array(7).fill(null).map((_, i) => ({
          dia: i, empleados: [], estado: 'vacio', indicacion: '',
        }));
        (h.turnos?.[t] || []).forEach(c => {
          if (c.dia >= 0 && c.dia <= 6) arr[c.dia] = c;
        });
        h.turnos[t] = arr;
      });
    });

    res.json({ horarios, semana, sucursal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener semana' });
  }
});

// ── POST /horarios/api/guardar ──────────────────────────────────
// Crea o actualiza un horario (upsert)
router.post('/api/guardar', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sucursal, semana, turnos } = req.body;

    // ===== LOGS TEMPORALES =====
    console.log(
      '[HORARIOS GUARDAR] body recibido:',
      JSON.stringify({ sucursal, semana }, null, 2)
    );

    console.log(
      '[HORARIOS GUARDAR] turnos.T1 length:',
      (turnos?.T1 || []).length
    );
    // ===========================

    if (!sucursal || !semana) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan sucursal o semana'
      });
    }

    const horario = await Horario.findOneAndUpdate(
      { sucursal, semana },
      {
        turnos,
        actualizadoEn: new Date()
      },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    return res.json({
      ok: true,
      id: String(horario._id)
    });

  } catch (err) {

    // ===== LOGS TEMPORALES =====
    console.error('[HORARIOS GUARDAR] Error:', err.message);
    console.error('[HORARIOS GUARDAR] Stack:', err.stack);
    // ===========================

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});
// ── POST /horarios/api/publicar/:id ─────────────────────────────
// Cambia el estado del horario a 'publicado'
router.post('/api/publicar/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await Horario.findByIdAndUpdate(req.params.id, {
      estado: 'publicado',
      actualizadoEn: new Date(),
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al publicar' });
  }
});

// ── POST /horarios/api/copiar-semana ────────────────────────────
// Copia el horario de una semana a otra como borrador
router.post('/api/copiar-semana', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sucursal, semanaOrigen, semanaDestino } = req.body;
    if (!sucursal || !semanaOrigen || !semanaDestino)
      return res.status(400).json({ error: 'Faltan campos' });

    const origen = await Horario.findOne({ sucursal, semana: semanaOrigen }).lean();
    if (!origen) return res.status(404).json({ error: 'Semana origen no encontrada' });

    const horario = await Horario.findOneAndUpdate(
      { sucursal, semana: semanaDestino },
      {
        turnos:        origen.turnos,
        estado:        'borrador',
        actualizadoEn: new Date(),
      },
      { upsert: true, new: true },
    );
    res.json({ ok: true, id: horario._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al copiar semana' });
  }
});

// ── DELETE /horarios/api/celda ──────────────────────────────────
// Vacía una celda específica (turno + dia) de un horario
router.delete('/api/celda', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { horarioId, turno, dia } = req.body;
    if (!horarioId || !turno || dia === undefined)
      return res.status(400).json({ error: 'Faltan campos' });

    const setKey = `turnos.${turno}.${dia}`;
    await Horario.findByIdAndUpdate(horarioId, {
      $set: {
        [`turnos.${turno}.${dia}.empleados`]:  [],
        [`turnos.${turno}.${dia}.estado`]:     'vacio',
        [`turnos.${turno}.${dia}.indicacion`]: '',
      },
      actualizadoEn: new Date(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al vaciar celda' });
  }
});

export default router;
