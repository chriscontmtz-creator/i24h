import { Router } from 'express';
import QRCode     from 'qrcode';
import Usuario    from '../models/Usuario.js';
import Producto   from '../models/Producto.js';
import Categoria  from '../models/Categoria.js';
import Promocion  from '../models/Promocion.js';
import FotoSucursal from '../models/FotoSucursal.js';
import { requireEmpleado, sesionActual } from '../middlewares/auth.js';
import { RECOMPENSAS, SUCURSALES_CLIENTE } from '../config/constants.js';

const router = Router();

// Única sucursal con el agente de sync activo hasta ahora (piloto en Simón
// Bolívar) — cuando se sincronicen más, agregar sus claves aquí ($in).
const SUCURSAL_CATALOGO = 'SimonBolivar';

// Arma el catálogo de precios para el panel de cliente a partir de los
// productos/categorías reales del sync — solo nombre y precio, agrupado
// por categoría; nunca se expone stock, mínimo, código ni _id de Mongo.
async function armarCatalogo() {
  const [productos, categorias] = await Promise.all([
    Producto.find({ sucursal: SUCURSAL_CATALOGO, precio: { $gt: 0 } })
      .select('nombre precio codCategoria -_id')
      .lean(),
    Categoria.find({ sucursal: SUCURSAL_CATALOGO }).select('codigo nombre -_id').lean(),
  ]);

  const nombrePorCodigo = new Map(categorias.map(c => [c.codigo, c.nombre]));
  const grupos = new Map();

  for (const p of productos) {
    const categoria = nombrePorCodigo.get(p.codCategoria) || 'Otros';
    if (!grupos.has(categoria)) grupos.set(categoria, []);
    grupos.get(categoria).push({ nombre: p.nombre, precio: p.precio });
  }

  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([categoria, productos]) => ({
      categoria,
      productos: productos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    }));
}

// Promociones activas y vigentes hoy — el panel admin ve todas (pasadas,
// futuras, inactivas); aquí solo se filtran las que el cliente debe ver.
async function promocionesVigentes() {
  const ahora = new Date();
  const promos = await Promocion.find({
    activa:      true,
    fechaInicio: { $lte: ahora },
    fechaFin:    { $gte: ahora },
  })
    .select('titulo descripcion imagenUrl beneficio fechaFin -_id')
    .sort({ fechaInicio: -1 })
    .lean();

  return promos.map(p => ({
    ...p,
    fechaFin: p.fechaFin.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }),
  }));
}

// Fotos de sucursal agrupadas — solo se listan sucursales que ya tengan
// al menos una foto subida por un admin (nada de placeholders vacíos).
async function fotosPorSucursal() {
  const fotos = await FotoSucursal.find().select('sucursal archivo -_id').sort({ createdAt: -1 }).lean();

  const grupos = new Map();
  for (const f of fotos) {
    if (!grupos.has(f.sucursal)) grupos.set(f.sucursal, []);
    grupos.get(f.sucursal).push('/imagenes/sucursales/' + f.archivo);
  }

  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([sucursal, urls]) => ({ sucursal, urls }));
}

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

// Las 9 sucursales reales de la cadena — mismo listado ya usado en
// dashboard.js/horarios.js/revisiones.js y en el JS de panel.hbs.
const TODAS_SUCURSALES = [
  'Simón Bolívar', 'Insurgentes', 'Antígona', 'Lincoln Oxxo', 'Lincoln 2',
  'Ruiz Cortines', 'Rodas', 'Cuauhtémoc', 'Ordóñez',
];

// GET /panel — panel de administración (solo empleados)
router.get('/panel', sesionActual, requireEmpleado, async (req, res) => {
  const u = req.session.usuario;
  const esColaborador = u.cargo === 'colaborador';

  // Un colaborador solo ve, en el selector de Bitácora, las sucursales que
  // tiene asignadas en su perfil — el resto de los cargos ven las 9.
  let sucursalesBitacora = TODAS_SUCURSALES;
  if (esColaborador) {
    const perfil = await Usuario.findById(u.id).select('sucursales').lean();
    sucursalesBitacora = perfil?.sucursales || [];
  }

  res.render('panel', {
    titulo:          'Panel i24h',
    scriptPrincipal: 'panel.js',
    estiloExtra:     'css/asistencia.css',
    estiloExtra2:    'css/modal-material.css',
    scriptExtra:     'js/modal-material.js',
    usuario:         u,
    esAdmin:         ['admin', 'coordinador'].includes(u.cargo),
    esSupervisorAsistencia: ['admin', 'coordinador', 'lider', 'encargado'].includes(u.cargo),
    esColaborador,
    sucursalesBitacora,
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
    const catalogo    = await armarCatalogo();
    const promociones = await promocionesVigentes();
    const fotosSucursales = await fotosPorSucursal();

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
      catalogo,
      promociones,
      fotosSucursales,
      hayHistorial:       historial.length > 0,
      hayCanjes:          (usuario.canjes || []).length > 0,
      hayCatalogo:        catalogo.length > 0,
      hayPromociones:     promociones.length > 0,
      hayFotosSucursales: fotosSucursales.length > 0,
    });
  } catch (err) {
    console.error('Error en /cliente:', err);
    res.redirect('/');
  }
});

export default router;
