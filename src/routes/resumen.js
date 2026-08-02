import { Router } from 'express';
import Usuario    from '../models/Usuario.js';
import { requireAuth } from '../middlewares/auth.js';
import { leer }        from '../utils/data.js';

const router = Router();

// GET /api/resumen — contadores para las tarjetas del panel
router.get('/resumen', requireAuth, async (req, res) => {
  try {
    const codigos     = leer('codigos.json');
    const comentarios = leer('comentarios.json');

    const [empleados, clientes] = await Promise.all([
      Usuario.countDocuments({ cargo: { $ne: 'cliente' }, activo: true }),
      Usuario.countDocuments({ cargo: 'cliente' }),
    ]);

    res.json({
      empleados,
      clientes,
      codigos:     codigos.filter(c => !c.usado).length,
      comentarios: comentarios.length,
    });
  } catch {
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
});

export default router;
