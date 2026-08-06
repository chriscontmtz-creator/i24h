import { Router } from 'express';
import bcrypt     from 'bcryptjs';
import Usuario    from '../models/Usuario.js';
import Empleado   from '../models/Empleado.js';
import Auditoria  from '../models/Auditoria.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import { sucursalesDeUsuario } from '../utils/sucursales.js';

const router = Router();

const SUCURSALES_STAFF = ['Simon Bolivar', 'Centro', 'Sureste'];

// ── Empleados (cuentas auth) ─────────────────────────────────────────────

// GET /api/empleados — admin ve a todos; coordinador y líder ven solo su
// equipo (cuentas que comparten sucursal con ellos, sin incluir otros
// admins/coordinadores); cualquier otro cargo no tiene vista de cuentas
// ajenas. Antes coordinador estaba agrupado con admin y veía la lista
// completa sin filtrar — corregido 2026-08-05.
router.get('/empleados', requireAuth, async (req, res) => {
  const sesion = req.session.usuario;
  try {
    let filtro;
    if (sesion.cargo === 'admin') {
      filtro = { cargo: { $ne: 'cliente' } };
    } else if (sesion.cargo === 'coordinador') {
      const sucursales = await sucursalesDeUsuario(sesion);
      filtro = { cargo: { $in: ['lider', 'encargado', 'colaborador'] }, sucursales: { $in: sucursales } };
    } else if (sesion.cargo === 'lider') {
      const sucursales = await sucursalesDeUsuario(sesion);
      filtro = { cargo: 'colaborador', sucursales: { $in: sucursales } };
    } else {
      return res.status(403).json({ error: 'Acceso restringido al personal autorizado.' });
    }
    const empleados = await Usuario.find(filtro).sort({ fechaCreacion: -1 });
    res.json(empleados);
  } catch {
    res.status(500).json({ error: 'Error al obtener empleados' });
  }
});

// POST /api/empleados — crea cuenta de empleado
router.post('/empleados', requireAuth, requireAdmin, async (req, res) => {
  const { correo, password, nombre, cargo, sucursales } = req.body;
  if (!correo || !password || !cargo) return res.status(400).json({ error: 'Faltan datos' });
  if (password.length < 6)           return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const cargosValidos = ['admin', 'coordinador', 'lider', 'encargado', 'colaborador'];
  if (!cargosValidos.includes(cargo)) return res.status(400).json({ error: 'Cargo inválido' });

  const sucursalesLimpias = Array.isArray(sucursales) ? sucursales : [];

  try {
    const nuevo = await Usuario.create({ correo, password, nombre, cargo, sucursales: sucursalesLimpias });
    res.json({ id: nuevo._id, correo: nuevo.correo, nombre: nuevo.nombre, cargo: nuevo.cargo, sucursales: nuevo.sucursales });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ese correo ya está registrado' });
    res.status(500).json({ error: 'Error al crear empleado' });
  }
});

// PATCH /api/empleados/:id/cargo
router.patch('/empleados/:id/cargo', requireAuth, requireAdmin, async (req, res) => {
  const { cargo } = req.body;
  const validos = ['admin', 'coordinador', 'lider', 'encargado', 'colaborador'];
  if (!validos.includes(cargo)) return res.status(400).json({ error: 'Cargo inválido' });
  try {
    const emp = await Usuario.findByIdAndUpdate(req.params.id, { cargo }, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ id: emp._id, cargo: emp.cargo });
  } catch { res.status(500).json({ error: 'Error al actualizar cargo' }); }
});

// PATCH /api/empleados/:id/sucursales
router.patch('/empleados/:id/sucursales', requireAuth, requireAdmin, async (req, res) => {
  const { sucursales } = req.body;
  if (!Array.isArray(sucursales)) return res.status(400).json({ error: 'Formato inválido' });
  try {
    const emp = await Usuario.findByIdAndUpdate(req.params.id, { sucursales }, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ id: emp._id, sucursales: emp.sucursales });
  } catch { res.status(500).json({ error: 'Error al actualizar sucursales' }); }
});

// PATCH /api/empleados/:id/turno
router.patch('/empleados/:id/turno', requireAuth, requireAdmin, async (req, res) => {
  const { turno } = req.body;
  const validos = ['T1', 'T2', 'T3', null];
  if (!validos.includes(turno ?? null)) return res.status(400).json({ error: 'Turno inválido' });
  try {
    const emp = await Usuario.findByIdAndUpdate(req.params.id, { turno: turno || null }, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ id: emp._id, turno: emp.turno });
  } catch { res.status(500).json({ error: 'Error al actualizar turno' }); }
});

// PATCH /api/empleados/:id/password
router.patch('/empleados/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const emp  = await Usuario.findByIdAndUpdate(req.params.id, { password: hash }, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error al cambiar contraseña' }); }
});

// ── Staff (desempeño) ────────────────────────────────────────────────────

// GET /api/staff?sucursal=&orden=
router.get('/staff', requireAuth, async (req, res) => {
  const { sucursal, orden = 'puntaje' } = req.query;
  const filtro = { activo: true };
  if (sucursal && SUCURSALES_STAFF.includes(sucursal)) filtro.sucursal = sucursal;

  try {
    let lista = await Empleado.find(filtro)
      .populate('lider_id', 'nombre')
      .populate('coordinador_id', 'nombre')
      .lean();

    if (orden === 'ventas')       lista.sort((a, b) => b.ventas_extraordinarias - a.ventas_extraordinarias);
    else if (orden === 'turnos')  lista.sort((a, b) => (b.turnos?.length || 0) - (a.turnos?.length || 0));
    else                          lista.sort((a, b) => b.puntos_acumulados - a.puntos_acumulados);

    res.json(lista);
  } catch { res.status(500).json({ error: 'Error al obtener staff' }); }
});

// GET /api/staff/:id/historial
router.get('/staff/:id/historial', requireAuth, async (req, res) => {
  try {
    const hist = await Auditoria.find({ empleado_id: req.params.id })
      .sort({ fecha: -1 }).limit(30).lean();
    const conPromedio = hist.map(a => {
      const s = a.ventas + a.actitud + a.cumplimiento + a.asistencia
              + a.limpieza + a.atencion_cliente + a.eficiencia;
      return { ...a, promedio: parseFloat((s / 7).toFixed(2)) };
    });
    res.json(conPromedio);
  } catch { res.status(500).json({ error: 'Error al obtener historial' }); }
});

// POST /api/staff — crear empleado de staff
router.post('/staff', requireAuth, requireAdmin, async (req, res) => {
  const { nombre, sucursal, lider_id, coordinador_id, rol, turnos } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  if (sucursal && !SUCURSALES_STAFF.includes(sucursal))
    return res.status(400).json({ error: 'Sucursal inválida' });
  try {
    const emp = await Empleado.create({ nombre: nombre.trim(), sucursal, lider_id, coordinador_id, rol, turnos });
    res.json(emp);
  } catch { res.status(500).json({ error: 'Error al crear empleado' }); }
});

// PATCH /api/staff/:id
router.patch('/staff/:id', requireAuth, requireAdmin, async (req, res) => {
  const campos = ['sucursal', 'lider_id', 'coordinador_id', 'rol', 'turnos',
                  'puntos_acumulados', 'ventas_extraordinarias', 'nivel_bono', 'activo'];
  const update = {};
  for (const c of campos) if (req.body[c] !== undefined) update[c] = req.body[c];

  if (update.sucursal && !SUCURSALES_STAFF.includes(update.sucursal))
    return res.status(400).json({ error: 'Sucursal inválida' });

  try {
    const emp = await Empleado.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(emp);
  } catch { res.status(500).json({ error: 'Error al actualizar empleado' }); }
});

// ── Auditorías ───────────────────────────────────────────────────────────

// GET /api/auditorias/hoy?sucursal=
router.get('/auditorias/hoy', requireAuth, async (req, res) => {
  const { sucursal } = req.query;
  const filtro = { activo: true };
  if (sucursal && SUCURSALES_STAFF.includes(sucursal)) filtro.sucursal = sucursal;

  try {
    const hoy    = new Date(); hoy.setHours(0, 0, 0, 0);
    const mañana = new Date(hoy); mañana.setDate(mañana.getDate() + 1);

    const [empleados, audHoy] = await Promise.all([
      Empleado.find(filtro).lean(),
      Auditoria.find({ fecha: { $gte: hoy, $lt: mañana } }).lean(),
    ]);

    const auditadosSet = new Set(audHoy.map(a => String(a.empleado_id)));
    const resultado = empleados.map(e => ({
      ...e,
      auditado_hoy:  auditadosSet.has(String(e._id)),
      auditoria_hoy: audHoy.find(a => String(a.empleado_id) === String(e._id)) || null,
    }));

    resultado.forEach(e => {
      if (e.auditoria_hoy) {
        const a = e.auditoria_hoy;
        const s = a.ventas + a.actitud + a.cumplimiento + a.asistencia
                + a.limpieza + a.atencion_cliente + a.eficiencia;
        e.auditoria_hoy.promedio = parseFloat((s / 7).toFixed(2));
      }
    });

    res.json(resultado);
  } catch { res.status(500).json({ error: 'Error al obtener auditorías de hoy' }); }
});

// POST /api/auditorias — registrar auditoría diaria
router.post('/auditorias', requireAuth, async (req, res) => {
  const RUBROS = ['ventas', 'actitud', 'cumplimiento', 'asistencia', 'limpieza', 'atencion_cliente', 'eficiencia'];
  const { empleado_id, lider_auditor_id, fecha, ...rubros } = req.body;

  if (!empleado_id) return res.status(400).json({ error: 'empleado_id requerido' });
  for (const r of RUBROS) {
    const v = Number(rubros[r]);
    if (!rubros[r] || v < 1 || v > 10) return res.status(400).json({ error: `Rubro inválido: ${r}` });
  }

  try {
    const dia     = fecha ? new Date(fecha) : new Date(); dia.setHours(0, 0, 0, 0);
    const siguiente = new Date(dia); siguiente.setDate(siguiente.getDate() + 1);
    const existente = await Auditoria.findOne({ empleado_id, fecha: { $gte: dia, $lt: siguiente } });
    if (existente) return res.status(409).json({ error: 'Este empleado ya tiene auditoría hoy' });

    const s              = RUBROS.reduce((acc, r) => acc + Number(rubros[r]), 0);
    const promedio       = parseFloat((s / 7).toFixed(2));
    const puntos_otorgados = Math.round(promedio * 10);

    const aud = await Auditoria.create({
      empleado_id,
      lider_auditor_id: lider_auditor_id || null,
      fecha:            fecha ? new Date(fecha) : new Date(),
      ...Object.fromEntries(RUBROS.map(r => [r, Number(rubros[r])])),
      puntos_otorgados,
    });

    await Empleado.findByIdAndUpdate(empleado_id, { $inc: { puntos_acumulados: puntos_otorgados } });

    res.json({ ...aud.toJSON(), promedio });
  } catch { res.status(500).json({ error: 'Error al registrar auditoría' }); }
});

export default router;
