import { Router } from 'express';
import mongoose from 'mongoose';
import Usuario from '../models/Usuario.js';

const router = Router();

// ── GET /socios/escanear/:qrId ──────────────────────────────────────────
// Landing al escanear el QR de puntos de un cliente (con la cámara nativa
// del teléfono, o desde el modal "Ver QR" del panel). Requiere sesión de
// admin/coordinador — mismo nivel de acceso que ya exige "Ajustar puntos"
// (PATCH /api/clientes/:id/puntos, clientes.js:19), que esta vista reusa
// tal cual desde el frontend en vez de duplicar la lógica de sumar puntos.
//
// No se usa requireAuth/requireAdmin (esos devuelven JSON, pensados para
// la API) — esta ruta la abre el navegador directo al escanear, así que
// hay que renderizar una página con el mensaje de error, igual que
// /asistencia/confirmar (asistencia.js:236-260).
//
// GET sin efectos secundarios a propósito (mismo criterio que
// /asistencia/confirmar): solo muestra los datos del cliente; la escritura
// real ocurre cuando el admin dispara el PATCH ya existente con un tap.
router.get('/escanear/:qrId', async (req, res) => {
  const { qrId } = req.params;
  const usuarioSesion = req.session.usuario;

  const render = (extra) => res.render('socios/escanear', {
    layout: 'main',
    titulo: 'Cliente escaneado',
    estiloExtra:  'css/asistencia.css',
    estiloExtra2: 'css/socios.css',
    ...extra,
  });

  if (!usuarioSesion || usuarioSesion.cargo === 'cliente') {
    return render({ error: 'Inicia sesión con tu cuenta de admin en el panel y vuelve a escanear el código.' });
  }
  if (!['admin', 'coordinador'].includes(usuarioSesion.cargo)) {
    return render({ error: 'Tu cuenta no tiene permiso para ver ni editar puntos de clientes.' });
  }

  try {
    // Fallback a _id: cuentas creadas antes de que existiera el campo qrId
    // (o que nunca visitaron /cliente para que se les generara uno) quedan
    // referenciadas por su ObjectId en el modal "Ver QR" del panel —
    // mismo criterio que usrVerQR() en panel.hbs (`qrId || id`).
    const filtro = mongoose.isValidObjectId(qrId)
      ? { $or: [{ qrId }, { _id: qrId }], cargo: 'cliente' }
      : { qrId, cargo: 'cliente' };

    const cliente = await Usuario.findOne(filtro)
      .select('nombre correo puntos historial')
      .lean();

    if (!cliente) {
      return render({ error: 'No se encontró ningún cliente con este código QR.' });
    }

    const historial = [...(cliente.historial || [])]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 5);

    render({
      cliente: {
        id:      cliente._id,
        nombre:  cliente.nombre,
        correo:  cliente.correo,
        puntos:  cliente.puntos || 0,
      },
      historial,
      hayHistorial: historial.length > 0,
    });
  } catch (err) {
    console.error('[socios] escanear:', err.message);
    render({ error: 'Error al buscar al cliente. Intenta de nuevo.' });
  }
});

export default router;
