// Catálogo de recompensas canjeables por puntos (clientes)
export const RECOMPENSAS = [
  { id: 'internet-30',   nombre: '30 min de internet gratis',    puntos: 50,  icono: 'ti-wifi'           },
  { id: 'internet-60',   nombre: '1 hora de internet gratis',     puntos: 100, icono: 'ti-clock'          },
  { id: 'impresion',     nombre: '10% descuento en impresiones',  puntos: 150, icono: 'ti-printer'        },
  { id: 'refresco',      nombre: 'Refresco gratis en sucursal',   puntos: 200, icono: 'ti-bottle'         },
  { id: 'internet-180',  nombre: '3 horas de internet gratis',    puntos: 300, icono: 'ti-device-desktop' },
  { id: 'kit-papeleria', nombre: 'Kit de papelería gratis',       puntos: 500, icono: 'ti-notebook'       },
];

// Sucursales que ve el cliente en "Sucursales más cercanas". Derivadas de la
// fuente única TODAS_SUCURSALES (las 9 reales de la cadena) — antes había 3
// sucursales inventadas (Mitras/Santa Catarina/Cumbres) que no existen. No se
// codifican calles ni coordenadas porque el repo no tiene las direcciones
// reales verificadas; el enlace abre una búsqueda de Google Maps por nombre
// (ver vistas.js), en vez de apuntar a coordenadas falsas.
import { TODAS_SUCURSALES } from '../utils/sucursales.js';

export const SUCURSALES_CLIENTE = TODAS_SUCURSALES.map(nombre => ({
  nombre,
  dir: 'Internet 24 Horas · Nuevo León',
}));
