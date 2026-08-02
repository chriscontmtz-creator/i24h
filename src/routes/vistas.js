import { Router } from 'express';
import QRCode     from 'qrcode';
import Usuario    from '../models/Usuario.js';
import { requireEmpleado, sesionActual } from '../middlewares/auth.js';
import { RECOMPENSAS, SUCURSALES_CLIENTE } from '../config/constants.js';

const router = Router();

// GET / — página principal
router.get('/', sesionActual, (req, res) => {
  const u = req.session.usuario || null;
  res.render('index', {
    titulo:          'Internet 24 Horas',
    scriptPrincipal: 'JAVA.js',
    anio:            new Date().getFullYear(),
    usuario:         u,
    logueado:        !!u,
    esAdmin:         u?.cargo === 'admin',
    esCoordinador:   ['admin', 'coordinador'].includes(u?.cargo),
    esLider:         ['admin', 'coordinador', 'lider'].includes(u?.cargo),
    esEncargado:     ['admin', 'coordinador', 'lider', 'encargado'].includes(u?.cargo),
    esEmpleado:      !!u && u.cargo !== 'cliente',
  });
});

// GET /panel — panel de administración (solo empleados)
router.get('/panel', sesionActual, requireEmpleado, (req, res) => {
  const u = req.session.usuario;
  res.render('panel', {
    titulo:          'Panel i24h',
    scriptPrincipal: 'panel.js',
    estiloExtra2:    'public/css/modal-correccion.css',
    scriptExtra:     'public/js/modal-correccion.js',
    usuario:         u,
    esAdmin:         ['admin', 'coordinador'].includes(u.cargo),
  });
});

// GET /cliente — panel del cliente con QR, puntos y canjes
router.get('/cliente', sesionActual, async (req, res) => {
  const u = req.session.usuario;
  if (!u)                    return res.redirect('/');
  if (u.cargo !== 'cliente') return res.redirect('/panel');

  try {
    const usuario = await Usuario.findById(u.id);
    if (!usuario) return res.redirect('/');

    if (!usuario.qrId) await usuario.save();

    const qrDataUrl = await QRCode.toDataURL(`i24h:${usuario.qrId}`, {
      width:  250,
      margin: 2,
      color: { dark: '#1e0a0a', light: '#ffffff' },
    });

    const recompensas = RECOMPENSAS.map(r => ({ ...r, disponible: usuario.puntos >= r.puntos }));
    const historial   = [...(usuario.historial || [])].reverse().slice(0, 10);
    const sucursales  = SUCURSALES_CLIENTE.map(s => ({
      ...s,
      mapsUrl: `https://maps.google.com/?q=${s.lat},${s.lng}`,
    }));

    res.render('cliente', {
      titulo:          'Mi cuenta — i24h',
      scriptPrincipal: 'JAVA.js',
      estiloExtra:     'cliente.css',
      anio:            new Date().getFullYear(),
      usuario: {
        id:     usuario._id.toString(),
        correo: usuario.correo,
        nombre: usuario.nombre,
        puntos: usuario.puntos,
        qrId:   usuario.qrId,
        canjes: usuario.canjes || [],
      },
      qrDataUrl,
      recompensas,
      historial,
      sucursales,
      hayHistorial: historial.length > 0,
      hayCanjes:    (usuario.canjes || []).length > 0,
    });
  } catch (err) {
    console.error('Error en /cliente:', err);
    res.redirect('/');
  }
});

export default router;
