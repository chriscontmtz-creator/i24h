import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { soloAdmin }   from '../middlewares/soloAdmin.js';
import {
  listarRegistros,
  obtenerRegistro,
  crearRegistro,
  corregirRegistro,
  patchItem,
  resumenBD,
} from '../controllers/ventasController.js';

const router = Router();

// Lectura: cualquier empleado autenticado puede ver
router.get('/ventas/resumen-bd',           requireAuth, resumenBD);
router.get('/ventas/registros',            requireAuth, listarRegistros);
router.get('/ventas/registros/:id',        requireAuth, obtenerRegistro);

// Escritura y correcciones: solo admin / coordinador
router.post ('/ventas/registros',           soloAdmin, crearRegistro);
router.put  ('/ventas/registros/:id',       soloAdmin, corregirRegistro);   // reemplaza todo + guarda historial
router.patch('/ventas/registros/:id/items', soloAdmin, patchItem);          // modifica ítem individual

export default router;
