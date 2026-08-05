import { Router } from 'express';
import Cotizacion, { SERVICIOS_COTIZACION } from '../models/Cotizacion.js';
import { SUCURSALES } from '../models/FotoSucursal.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';

const router = Router();

// POST /api/cotizaciones — crea una solicitud de cotización.
// PÚBLICO A PROPÓSITO: lo llena cualquier visitante del home sin sesión,
// igual que /api/comentarios. Cubierto por el rate-limit global de /api
// (100/15min/IP, servidor.js) y por mongoSanitize() (limpia operadores
// Mongo del body antes de llegar aquí).
router.post('/cotizaciones', async (req, res) => {
  const { nombre, contacto, servicio, sucursal, mensaje } = req.body;

  if (typeof nombre !== 'string' || typeof contacto !== 'string' || typeof servicio !== 'string')
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  if (!nombre.trim() || !contacto.trim())
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  if (nombre.trim().length > 120 || contacto.trim().length > 120)
    return res.status(400).json({ error: 'Nombre o contacto demasiado largo' });
  if (!SERVICIOS_COTIZACION.includes(servicio))
    return res.status(400).json({ error: 'Servicio inválido' });
  if (sucursal && !SUCURSALES.includes(sucursal))
    return res.status(400).json({ error: 'Sucursal inválida' });
  if (mensaje && (typeof mensaje !== 'string' || mensaje.length > 1000))
    return res.status(400).json({ error: 'Mensaje demasiado largo' });

  try {
    await Cotizacion.create({
      nombre:   nombre.trim(),
      contacto: contacto.trim(),
      servicio,
      sucursal: sucursal || null,
      mensaje:  (mensaje || '').trim(),
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al enviar la solicitud' });
  }
});

// GET /api/cotizaciones — lista todas las solicitudes (panel admin, más
// recientes primero). Solo staff — nunca público.
router.get('/cotizaciones', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cotizaciones = await Cotizacion.find().sort({ createdAt: -1 });
    res.json(cotizaciones);
  } catch {
    res.status(500).json({ error: 'Error al obtener las cotizaciones' });
  }
});

// PATCH /api/cotizaciones/:id — marca atendida/pendiente.
router.patch('/cotizaciones/:id', requireAuth, requireAdmin, async (req, res) => {
  const { estado } = req.body;
  if (!['pendiente', 'atendida'].includes(estado))
    return res.status(400).json({ error: 'Estado inválido' });

  try {
    const cot = await Cotizacion.findById(req.params.id);
    if (!cot) return res.status(404).json({ error: 'Solicitud no encontrada' });

    cot.estado = estado;
    cot.atendidaPor = estado === 'atendida'
      ? (req.session.usuario?.nombre || req.session.usuario?.correo || 'admin')
      : null;

    await cot.save();
    res.json(cot);
  } catch {
    res.status(500).json({ error: 'Error al actualizar la solicitud' });
  }
});

export default router;
