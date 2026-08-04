import { Router } from 'express';
import { leer, guardar } from '../utils/data.js';
import { requireAuth }  from '../middlewares/auth.js';
import { sucursalPermitida } from '../utils/sucursales.js';

const router = Router();

// GET /api/reportes — devuelve todos los reportes (más recientes primero)
router.get('/reportes', requireAuth, (req, res) => {
  const { sucursal, dept, status } = req.query;
  let lista = leer('reportes.json');

  if (sucursal && sucursal !== 'all') lista = lista.filter(r => r.sucursal === sucursal);
  if (dept     && dept     !== 'all') lista = lista.filter(r => r.dept === dept);
  if (status   && status   !== 'all') lista = lista.filter(r => r.status === status);

  res.json(lista.slice().reverse());
});

// POST /api/reportes — guarda un reporte nuevo
router.post('/reportes', requireAuth, async (req, res) => {
  const { sucursal, dept, descripcion, numImpresora, marca, mensaje } = req.body;
  if (!sucursal || !dept || !descripcion)
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  if (!(await sucursalPermitida(req.session.usuario, sucursal)))
    return res.status(403).json({ error: 'No tienes acceso a esa sucursal.' });

  const lista  = leer('reportes.json');
  const nuevo  = {
    id:          Date.now(),
    sucursal,
    dept,
    descripcion: descripcion.trim(),
    numImpresora: numImpresora || '',
    marca:        marca        || '',
    mensaje:      mensaje      || '',
    status:      'pendiente',
    fecha:       new Date().toISOString(),
    creadoPor:   req.session.usuario?.nombre || 'Sistema',
  };
  lista.push(nuevo);
  guardar('reportes.json', lista);
  res.json(nuevo);
});

// PATCH /api/reportes/:id/status — cambia el estado de un reporte
router.patch('/reportes/:id/status', requireAuth, (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const { status } = req.body;
  if (!['pendiente','realizado'].includes(status))
    return res.status(400).json({ error: 'Estado inválido' });

  const lista  = leer('reportes.json');
  const idx    = lista.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Reporte no encontrado' });

  lista[idx].status = status;
  lista[idx].actualizadoEn = new Date().toISOString();
  guardar('reportes.json', lista);
  res.json(lista[idx]);
});

export default router;
