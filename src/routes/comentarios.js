import { Router } from 'express';
import { leer, guardar } from '../utils/data.js';

const router = Router();

// GET /api/comentarios — devuelve todos los comentarios (más recientes primero)
router.get('/comentarios', (req, res) => {
  const lista = leer('comentarios.json');
  res.json(lista.slice().reverse());
});

// POST /api/comentarios — guarda un comentario nuevo
router.post('/comentarios', (req, res) => {
  const { texto, estrellas } = req.body;
  if (!texto || !estrellas)           return res.status(400).json({ error: 'Faltan datos' });
  if (estrellas < 1 || estrellas > 5) return res.status(400).json({ error: 'Estrellas inválidas' });

  const lista = leer('comentarios.json');
  const nuevo = {
    id:        Date.now(),
    texto:     texto.trim(),
    estrellas,
    fecha:     new Date().toISOString(),
  };
  lista.push(nuevo);
  guardar('comentarios.json', lista);
  res.json(nuevo);
});

export default router;
