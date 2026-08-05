import { Router } from 'express';
import QRCode     from 'qrcode';
import Usuario    from '../models/Usuario.js';
import Producto   from '../models/Producto.js';
import Categoria  from '../models/Categoria.js';
import Promocion  from '../models/Promocion.js';
import FotoSucursal, { SUCURSALES } from '../models/FotoSucursal.js';
import { SERVICIOS_COTIZACION } from '../models/Cotizacion.js';
import { requireEmpleado, sesionActual } from '../middlewares/auth.js';
import { RECOMPENSAS, SUCURSALES_CLIENTE } from '../config/constants.js';
import { sucursalesDeUsuario } from '../utils/sucursales.js';

const router = Router();

// Slugs que ya usaba el filtro de Ventas (datos mock, ver src/routes/ventas.js
// y data/ventas.json) — distintos del nombre con acentos usado en todo lo demás.
const SLUG_VENTA = {
  'Simón Bolívar': 'simon-bolivar',
  'Insurgentes':   'insurgentes',
  'Antígona':      'antigona',
  'Lincoln Oxxo':  'lincoln-oxxo',
  'Lincoln 2':     'lincoln-2',
  'Ruiz Cortines': 'ruiz-cortines',
  'Rodas':         'rodas',
  'Cuauhtémoc':    'cuauhtemoc',
  'Ordóñez':       'ordonez',
};

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
router.get('/', sesionActual, async (req, res) => {
  const u = req.session.usuario || null;

  // Falla suave: si Mongo tiene un hipo, el home sigue cargando sin fotos
  // en vez de romperse — a diferencia de /cliente, aquí no hay a dónde
  // redirigir sin causar un loop (GET / no puede redirigir a GET /).
  let fotosSucursales = [];
  try {
    fotosSucursales = await fotosPorSucursal();
  } catch (err) {
    console.error('Error al cargar fotos de sucursal en GET /:', err);
  }

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
    fotosSucursales,
    hayFotosSucursales:  fotosSucursales.length > 0,
    serviciosCotizacion: SERVICIOS_COTIZACION,
    sucursalesCotizacion: SUCURSALES,
  });
});

// GET /panel — panel de administración (solo empleados)
router.get('/panel', sesionActual, requireEmpleado, async (req, res) => {
  const u = req.session.usuario;
  const esColaborador = u.cargo === 'colaborador';

  // Solo admin ve las 9 sucursales en todos los selectores del panel;
  // cualquier otro cargo (coordinador, lider, encargado, colaborador) solo
  // ve las que tiene asignadas en su perfil — si no tiene ninguna, no ve
  // ninguna. Se usa en Bitácoras, Ventas, Inventario, Reportes, Fotos,
  // Tickets I24H y el reporte de Asistencia.
  const sucursalesUsuario = await sucursalesDeUsuario(u);

  // El filtro de Ventas usa slugs propios (datos mock, ver ventas.js) en vez
  // del nombre con acentos — se arma aparte solo para ese selector.
  const sucursalesUsuarioVenta = sucursalesUsuario.map(nombre => ({
    nombre,
    slug: SLUG_VENTA[nombre] || nombre,
  }));

  res.render('panel', {
    titulo:          'Panel i24h',
    scriptPrincipal: 'panel.js',
    estiloExtra:     'css/asistencia.css',
    estiloExtra2:    'css/modal-material.css',
    scriptExtra:     'js/modal-material.js',
    usuario:         u,
    esAdmin:         ['admin', 'coordinador'].includes(u.cargo),
    esLider:         u.cargo === 'lider',
    esSupervisorAsistencia: ['admin', 'coordinador', 'lider', 'encargado'].includes(u.cargo),
    esSupervisorBitacoras: ['admin', 'coordinador', 'lider'].includes(u.cargo),
    esColaborador,
    sucursalesUsuario,
    sucursalesUsuarioVenta,
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

    // Antes codificaba el texto literal "i24h:<qrId>", que no es una URL —
    // al escanearlo con la cámara del teléfono no pasaba nada porque no
    // hay ningún link que abrir. Ahora apunta a /socios/escanear/:qrId
    // (mismo patrón que el QR de asistencia, asistencia.js:217-219), que sí
    // es una página real donde el staff ve los puntos del cliente y puede
    // sumarle puntos en el momento.
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const qrDataUrl = await QRCode.toDataURL(`${baseUrl}/socios/escanear/${usuario.qrId}`, {
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
