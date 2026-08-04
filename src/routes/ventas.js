import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { leer } from '../utils/data.js';
import { sucursalConectada } from '../utils/sucursales.js';

const router = Router();

const VNT_MULT = { hoy: 1, '7': 7, '15': 15, '30': 30 };
const CATS     = ['Novedades', 'Papelería', 'Snack'];

// Lee los JSON cada vez que llega una petición (sin reiniciar el servidor)
function getVentas()   { return leer('ventas.json');   }
function getProductos(){ return leer('productos.json'); }
function getAlertas()  { return leer('alertas.json');  }

// GET /api/ventas?sucursal=&periodo=
router.get('/ventas', requireAuth, (req, res) => {
  const { sucursal = 'todas', periodo = '7' } = req.query;
  const mult = VNT_MULT[periodo] || 7;

  const data       = getVentas();
  const sucursales = data.sucursales || [];
  const filtradas  = sucursal === 'todas'
    ? sucursales
    : sucursales.filter(s => s.id === sucursal);

  const desglose = filtradas.map(s => {
    const conectada = sucursalConectada(s.nombre);
    const categorias = {};
    let totalSuc = 0;
    CATS.forEach(cat => {
      const val = conectada ? Math.round((s[cat] || 0) * mult) : 0;
      categorias[cat] = val;
      totalSuc += val;
    });
    return { id: s.id, nombre: s.nombre, total: totalSuc, categorias, delta: conectada ? (s.delta || 0) : 0 };
  });

  const totalGeneral  = desglose.reduce((a, s) => a + s.total, 0);
  const topSucursal   = [...desglose].sort((a, b) => b.total - a.total)[0];
  const conectadas    = desglose.filter(s => sucursalConectada(s.nombre));
  const deltaPromedio = Math.round(
    conectadas.reduce((a, s) => a + s.delta, 0) / (conectadas.length || 1) * 10
  ) / 10;

  const porCategoria = {};
  CATS.forEach(cat => {
    porCategoria[cat] = desglose.reduce((a, s) => a + (s.categorias[cat] || 0), 0);
  });
  const topCategoria = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0];

  res.json({
    periodo, sucursal, totalGeneral,
    topSucursal:  topSucursal  ? { id: topSucursal.id, nombre: topSucursal.nombre, total: topSucursal.total } : null,
    topCategoria: topCategoria ? { nombre: topCategoria[0], total: topCategoria[1] } : null,
    deltaPromedio, desglose, porCategoria,
  });
});

// GET /api/ventas/top-productos?categoria=&periodo=
router.get('/ventas/top-productos', requireAuth, (req, res) => {
  const { categoria = 'todas', periodo = '7' } = req.query;
  const mult = VNT_MULT[periodo] || 7;

  const lista = getProductos().filter(p => sucursalConectada(p.sucursal));
  const filtrados = categoria === 'todas' ? lista : lista.filter(p => p.categoria === categoria);

  const resultado = filtrados.slice(0, 10).map(p => ({
    nombre:    p.nombre,
    categoria: p.categoria,
    sucursal:  p.sucursal,
    unidades:  Math.round(p.unidades * mult / 7),
    venta:     Math.round(p.unidades * mult / 7 * p.precio),
  }));

  res.json(resultado);
});

// GET /api/ventas/alertas
router.get('/ventas/alertas', requireAuth, (req, res) => {
  res.json(getAlertas().filter(a => sucursalConectada(a.sucursal)));
});

export default router;
