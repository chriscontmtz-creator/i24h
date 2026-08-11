import { Router } from 'express';
import fs         from 'fs';
import path       from 'path';
import QRCode     from 'qrcode';
import Usuario    from '../models/Usuario.js';
import Producto   from '../models/Producto.js';
import Categoria  from '../models/Categoria.js';
import Promocion  from '../models/Promocion.js';
import FotoSucursal, { SUCURSALES } from '../models/FotoSucursal.js';
import { SERVICIOS_COTIZACION } from '../models/Cotizacion.js';
import { requireEmpleado, sesionActual } from '../middlewares/auth.js';
import { RECOMPENSAS, SUCURSALES_CLIENTE } from '../config/constants.js';
import { sucursalesDeUsuario, TODAS_SUCURSALES, SUCURSALES_CONECTADAS } from '../utils/sucursales.js';

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

// ── Limpieza de artefactos de importación (BUG-09) ──────────────────────────
// Los nombres de producto vienen del sync de CyberPlanet y traen basura del
// import (mayúsculas sin acentos, sufijos numéricos pegados a nombres de
// estado, etc.: "AGUASCALIENES1", "NUEVOLEON2", "SAN LUI POTOSI1"). Esto NO
// corrige la base de datos —el sync la reescribiría en el próximo corte— sino
// que normaliza el texto al momento de mostrar el catálogo al cliente.
const ESTADOS_MX = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
  'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango',
  'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'México', 'Michoacán',
  'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro',
  'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco',
  'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas',
];
const claveEstado = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const ESTADO_POR_CLAVE = new Map(ESTADOS_MX.map(e => [claveEstado(e), e]));

// Typos que no se resuelven por coincidencia directa (falta una letra o hay
// error de dedo) — corrección explícita, clave en mayúsculas.
const FIX_NOMBRE_PRODUCTO = new Map([
  ['AGUASCALIENES1',  'Aguascalientes'],
  ['SAN LUI POTOSI1', 'San Luis Potosí'],
]);

function normalizarNombreProducto(nombre) {
  const original = (nombre || '').trim();
  const fijo = FIX_NOMBRE_PRODUCTO.get(original.toUpperCase());
  if (fijo) return fijo;
  // Nombre de estado con sufijo numérico pegado por el import (NUEVOLEON2,
  // JALISCO1...) — si al quitar los dígitos finales coincide con un estado
  // real, devuelve el nombre canónico con acentos y espacios. Solo se aplica
  // a nombres que resultan ser un estado; el resto de productos (que sí pueden
  // terminar legítimamente en número) queda intacto.
  const sinSufijo = original.replace(/\d+$/, '');
  if (sinSufijo !== original) {
    const estado = ESTADO_POR_CLAVE.get(claveEstado(sinSufijo));
    if (estado) return estado;
  }
  return original;
}

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
    grupos.get(categoria).push({ nombre: normalizarNombreProducto(p.nombre), precio: p.precio });
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

// Carpeta física donde el módulo Fotos (fotos.js) guarda las imágenes subidas.
const DIR_FOTOS_SUCURSAL = path.join(process.cwd(), 'public', 'imagenes', 'sucursales');

// Fotos de sucursal agrupadas. Devuelve SIEMPRE las 9 sucursales reales (con o
// sin foto) para que "Conoce nuestras sucursales" muestre el directorio
// completo, no solo la única que tenía registro. Ignora registros cuyo archivo
// ya no existe en disco (la carpeta puede quedar vacía tras un redeploy en
// Render, que no persiste el filesystem) — así no se pinta un <img> roto; esas
// sucursales caen al placeholder "Foto próximamente" del template.
async function fotosPorSucursal() {
  const fotos = await FotoSucursal.find().select('sucursal archivo -_id').sort({ createdAt: -1 }).lean();

  const porSucursal = new Map();
  for (const f of fotos) {
    if (!fs.existsSync(path.join(DIR_FOTOS_SUCURSAL, f.archivo))) continue;
    if (!porSucursal.has(f.sucursal)) porSucursal.set(f.sucursal, []);
    porSucursal.get(f.sucursal).push('/imagenes/sucursales/' + f.archivo);
  }

  return SUCURSALES.map(sucursal => ({
    sucursal,
    urls: porSucursal.get(sucursal) || [],
  }));
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

  // Scoping por sucursal de la vista "Sucursales" (BUG-03). Las 9 tarjetas del
  // grid son HTML estático; este mapa nombre→boolean permite que la plantilla
  // muestre solo las sucursales que el usuario tiene a su mando. Mismo criterio
  // que Ventas: admin ve las 9 (sucursalesDeUsuario devuelve TODAS), cualquier
  // otro cargo solo las asignadas.
  const sucursalesVisibles = {};
  for (const s of TODAS_SUCURSALES) sucursalesVisibles[s] = sucursalesUsuario.includes(s);

  // Etiqueta de alcance para el sidebar (BUG-10). Antes decía "Todas" fijo para
  // cualquier rol; ahora refleja el scope real: admin (y quien vea las 9) ve
  // "Todas", un rol de una sola sucursal ve su nombre, varios ven el conteo.
  let sucursalScope;
  if (u.cargo === 'admin' || sucursalesUsuario.length >= TODAS_SUCURSALES.length) {
    sucursalScope = 'Todas';
  } else if (sucursalesUsuario.length === 0) {
    sucursalScope = 'Sin sucursal';
  } else if (sucursalesUsuario.length === 1) {
    sucursalScope = sucursalesUsuario[0];
  } else {
    sucursalScope = sucursalesUsuario.length + ' sucursales';
  }

  // Cabecera de la vista Sucursales (BUG-03). El contador y las sumas deben
  // reflejar SOLO las sucursales a mando del usuario, no las 9. Numerador = de
  // sus sucursales visibles, cuántas tienen sync en línea; denominador = cuántas
  // ve en total. Admin/coordinador con las 9 asignadas ven "X / 9".
  const sucursalesEnLinea = sucursalesUsuario.filter(s => SUCURSALES_CONECTADAS.includes(s)).length;
  const totalSucursales   = sucursalesUsuario.length;
  const veTodasSucursales = u.cargo === 'admin' || sucursalesUsuario.length >= TODAS_SUCURSALES.length;
  let recaudacionScope;
  if (veTodasSucursales)                 recaudacionScope = 'Suma de todas las sucursales';
  else if (sucursalesUsuario.length === 0) recaudacionScope = 'Sin sucursal asignada';
  else if (sucursalesUsuario.length === 1) recaudacionScope = sucursalesUsuario[0];
  else                                     recaudacionScope = 'Suma de tus sucursales';

  res.render('panel', {
    titulo:          'Panel i24h',
    scriptPrincipal: 'panel.js',
    estiloExtra:     'css/asistencia.css',
    estiloExtra2:    'css/modal-material.css',
    scriptExtra:     'js/modal-material.js',
    usuario:         u,
    esAdmin:         ['admin', 'coordinador'].includes(u.cargo),
    // Admin "puro" — a diferencia de esAdmin (admin+coordinador, que sigue
    // gateando Tickets I24H/Promociones/Fotos/Cotizaciones/Configuración sin
    // cambios), esto distingue quién ve TODOS los usuarios sin filtrar.
    esAdminPuro:     u.cargo === 'admin',
    esLider:         u.cargo === 'lider',
    // Quién ve la sección de equipo (como "Usuarios" completo o como "Mi
    // equipo" filtrado) — admin ve todos, coordinador y líder ven su equipo.
    esGestorEquipo:  ['admin', 'coordinador', 'lider'].includes(u.cargo),
    esSupervisorAsistencia: ['admin', 'coordinador', 'lider', 'encargado'].includes(u.cargo),
    esSupervisorBitacoras: ['admin', 'coordinador', 'lider'].includes(u.cargo),
    esColaborador,
    sucursalesUsuario,
    sucursalesUsuarioVenta,
    sucursalScope,
    sucursalesVisibles,
    // "En línea" en la tarjeta de Sucursales = sucursales del usuario con el
    // sync de CyberPlanet reportando datos en vivo (no "abiertas", que para una
    // cadena 24/7 son todas). Numerador y denominador acotados a las sucursales
    // visibles del usuario (BUG-03).
    sucursalesEnLinea,
    totalSucursales,
    recaudacionScope,
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
      // Búsqueda por nombre en Maps — no hay coordenadas reales verificadas
      // de cada sucursal, así que apuntamos a una búsqueda en vez de a un
      // par lat/lng inventado (ver constants.js).
      mapsUrl: `https://www.google.com/maps/search/${encodeURIComponent('Internet 24 Horas ' + s.nombre + ' Nuevo León')}`,
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
