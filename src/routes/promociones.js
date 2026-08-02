import { Router } from 'express';
import Promocion  from '../models/Promocion.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';

const router = Router();

// GET /api/promociones — lista todas (panel admin: incluye pasadas/futuras/inactivas)
router.get('/promociones', requireAuth, async (req, res) => {
  try {
    const promociones = await Promocion.find().sort({ fechaInicio: -1 });
    res.json(promociones);
  } catch {
    res.status(500).json({ error: 'Error al obtener promociones' });
  }
});

// POST /api/promociones — crea una promoción nueva
router.post('/promociones', requireAuth, requireAdmin, async (req, res) => {
  const { titulo, descripcion, imagenUrl, beneficio, fechaInicio, fechaFin, activa } = req.body;
  if (!titulo?.trim() || !descripcion?.trim() || !fechaInicio || !fechaFin)
    return res.status(400).json({ error: 'Faltan campos obligatorios' });

  const inicio = new Date(fechaInicio);
  const fin    = new Date(fechaFin);
  if (isNaN(inicio) || isNaN(fin))
    return res.status(400).json({ error: 'Fechas inválidas' });
  if (fin < inicio)
    return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la de inicio' });

  try {
    const nueva = await Promocion.create({
      titulo:      titulo.trim(),
      descripcion: descripcion.trim(),
      imagenUrl:   (imagenUrl || '').trim(),
      beneficio:   (beneficio || '').trim(),
      fechaInicio: inicio,
      fechaFin:    fin,
      activa:      activa !== false,
      creadoPor:   req.session.usuario?.nombre || req.session.usuario?.correo || 'admin',
    });
    res.json(nueva);
  } catch {
    res.status(500).json({ error: 'Error al crear la promoción' });
  }
});

// PATCH /api/promociones/:id — edita una promoción existente
router.patch('/promociones/:id', requireAuth, requireAdmin, async (req, res) => {
  const { titulo, descripcion, imagenUrl, beneficio, fechaInicio, fechaFin, activa } = req.body;

  try {
    const promo = await Promocion.findById(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });

    if (titulo !== undefined)      promo.titulo      = titulo.trim();
    if (descripcion !== undefined) promo.descripcion = descripcion.trim();
    if (imagenUrl !== undefined)   promo.imagenUrl    = imagenUrl.trim();
    if (beneficio !== undefined)   promo.beneficio    = beneficio.trim();
    if (activa !== undefined)      promo.activa       = !!activa;

    if (fechaInicio !== undefined) {
      const inicio = new Date(fechaInicio);
      if (isNaN(inicio)) return res.status(400).json({ error: 'Fecha de inicio inválida' });
      promo.fechaInicio = inicio;
    }
    if (fechaFin !== undefined) {
      const fin = new Date(fechaFin);
      if (isNaN(fin)) return res.status(400).json({ error: 'Fecha de fin inválida' });
      promo.fechaFin = fin;
    }
    if (promo.fechaFin < promo.fechaInicio)
      return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la de inicio' });

    if (!promo.titulo?.trim() || !promo.descripcion?.trim())
      return res.status(400).json({ error: 'Título y descripción son obligatorios' });

    await promo.save();
    res.json(promo);
  } catch {
    res.status(500).json({ error: 'Error al actualizar la promoción' });
  }
});

// DELETE /api/promociones/:id — elimina una promoción
router.delete('/promociones/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const eliminada = await Promocion.findByIdAndDelete(req.params.id);
    if (!eliminada) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al eliminar la promoción' });
  }
});

export default router;
