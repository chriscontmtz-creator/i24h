import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import { leer, guardar } from '../utils/data.js';

const router = Router();

// GET /api/codigos — lista todos los códigos (más recientes primero)
router.get('/codigos', requireAuth, (req, res) => {
  const codigos = leer('codigos.json');
  res.json(codigos.slice().reverse());
});

// POST /api/codigos — genera un código nuevo de 8 caracteres
router.post('/codigos', requireAuth, requireAdmin, (req, res) => {
  const { creadoPor } = req.body;
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += caracteres[Math.floor(Math.random() * caracteres.length)];
  }

  const codigos = leer('codigos.json');
  const nuevo = {
    id:        Date.now(),
    codigo,
    usado:     false,
    usadoPor:  null,
    fechaUso:  null,
    creadoPor: creadoPor || 'admin',
    fecha:     new Date().toISOString(),
  };
  codigos.push(nuevo);
  guardar('codigos.json', codigos);
  res.json(nuevo);
});

// DELETE /api/codigos/:id — revoca un código que aún no fue usado
router.delete('/codigos/:id', requireAuth, requireAdmin, (req, res) => {
  const id      = parseInt(req.params.id);
  const codigos = leer('codigos.json');
  const idx     = codigos.findIndex(c => c.id === id);

  if (idx === -1)          return res.status(404).json({ error: 'Código no encontrado' });
  if (codigos[idx].usado)  return res.status(400).json({ error: 'No se puede eliminar un código ya usado' });

  codigos.splice(idx, 1);
  guardar('codigos.json', codigos);
  res.json({ ok: true });
});

export default router;
