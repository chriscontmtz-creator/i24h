import { Router } from 'express';
import Usuario    from '../models/Usuario.js';
import { requireAuth, requireAdmin, requireEmpleado } from '../middlewares/auth.js';
import { sucursalesDeUsuario } from '../utils/sucursales.js';

const router = Router();

// Admin/coordinador pueden tocar el estado de cualquier cuenta; un líder
// solo el de sus propios colaboradores (mismo criterio que GET /api/empleados
// en empleados.js: cargo 'colaborador' + sucursal compartida con el líder).
async function puedeCambiarEstado(sesion, objetivo) {
  if (['admin', 'coordinador'].includes(sesion.cargo)) return true;
  if (sesion.cargo !== 'lider' || objetivo.cargo !== 'colaborador') return false;
  const sucursalesLider = await sucursalesDeUsuario(sesion);
  return (objetivo.sucursales || []).some(s => sucursalesLider.includes(s));
}

// PATCH /api/usuarios/:id/estado — activa o desactiva una cuenta
router.patch('/usuarios/:id/estado', requireAuth, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!(await puedeCambiarEstado(req.session.usuario, usuario)))
      return res.status(403).json({ error: 'Acceso restringido al personal autorizado.' });
    usuario.activo = !usuario.activo;
    await usuario.save();
    res.json({ id: usuario._id, activo: usuario.activo });
  } catch {
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// DELETE /api/usuarios/:id — elimina una cuenta (no se puede autoeliminar)
router.delete('/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (String(usuario._id) === String(req.session.usuario?.id))
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

    await Usuario.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// PATCH /api/mi-perfil — el empleado actualiza su propio nombre y turno
router.patch('/mi-perfil', requireEmpleado, async (req, res) => {
  try {
    const { nombre, turno } = req.body;
    const update = {};
    if (nombre !== undefined) {
      const n = String(nombre).trim();
      if (!n) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      update.nombre = n;
    }
    if (turno !== undefined) {
      if (!['T1', 'T2', 'T3', null].includes(turno || null))
        return res.status(400).json({ error: 'Turno inválido' });
      update.turno = turno || null;
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });

    const usuario = await Usuario.findByIdAndUpdate(req.session.usuario.id, update, { new: true });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (update.nombre) req.session.usuario.nombre = update.nombre;
    if ('turno' in update) req.session.usuario.turno = update.turno;

    res.json({ ok: true, nombre: usuario.nombre, turno: usuario.turno });
  } catch {
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

export default router;
