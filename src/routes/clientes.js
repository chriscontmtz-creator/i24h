import { Router }  from 'express';
import Usuario     from '../models/Usuario.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import { RECOMPENSAS } from '../config/constants.js';

const router = Router();

// GET /api/clientes — lista todos los clientes registrados
router.get('/clientes', requireAuth, async (req, res) => {
  try {
    const clientes = await Usuario.find({ cargo: 'cliente' }).sort({ fechaCreacion: -1 });
    res.json(clientes);
  } catch {
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// PATCH /api/clientes/:id/puntos — ajusta los puntos de un cliente
router.patch('/clientes/:id/puntos', requireAuth, requireAdmin, async (req, res) => {
  const { ajuste, motivo } = req.body;
  if (typeof ajuste !== 'number') return res.status(400).json({ error: 'Ajuste inválido' });
  if (!motivo?.trim())            return res.status(400).json({ error: 'El motivo es obligatorio' });
  try {
    const cli = await Usuario.findById(req.params.id);
    if (!cli || cli.cargo !== 'cliente') return res.status(404).json({ error: 'Cliente no encontrado' });
    cli.puntos = Math.max(0, (cli.puntos || 0) + ajuste);
    await cli.save();
    res.json({ id: cli._id, puntos: cli.puntos });
  } catch { res.status(500).json({ error: 'Error al ajustar puntos' }); }
});

// GET /api/clientes/:id/canjes — devuelve el historial de canjes
router.get('/clientes/:id/canjes', requireAuth, async (req, res) => {
  try {
    const cli = await Usuario.findById(req.params.id);
    if (!cli || cli.cargo !== 'cliente') return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ canjes: cli.canjes || [] });
  } catch { res.status(500).json({ error: 'Error al obtener canjes' }); }
});

// POST /api/canjear — descuenta puntos y registra el canje
router.post('/canjear', requireAuth, async (req, res) => {
  const { recompensaId } = req.body;
  const u = req.session.usuario;
  if (u.cargo !== 'cliente') return res.status(403).json({ error: 'Solo clientes pueden canjear.' });

  const recompensa = RECOMPENSAS.find(r => r.id === recompensaId);
  if (!recompensa) return res.status(400).json({ error: 'Recompensa no válida.' });

  try {
    const usuario = await Usuario.findById(u.id);
    if (usuario.puntos < recompensa.puntos)
      return res.status(400).json({ error: 'No tienes suficientes puntos.' });

    usuario.puntos -= recompensa.puntos;
    usuario.canjes.push({ recompensa: recompensa.nombre, puntosUsados: recompensa.puntos });
    await usuario.save();

    req.session.usuario.puntos = usuario.puntos;
    res.json({ ok: true, puntosRestantes: usuario.puntos, recompensa: recompensa.nombre });
  } catch {
    res.status(500).json({ error: 'Error al procesar el canje.' });
  }
});

export default router;
