// Catálogo de recompensas canjeables por puntos (clientes)
export const RECOMPENSAS = [
  { id: 'internet-30',   nombre: '30 min de internet gratis',    puntos: 50,  icono: 'ti-wifi'           },
  { id: 'internet-60',   nombre: '1 hora de internet gratis',     puntos: 100, icono: 'ti-clock'          },
  { id: 'impresion',     nombre: '10% descuento en impresiones',  puntos: 150, icono: 'ti-printer'        },
  { id: 'refresco',      nombre: 'Refresco gratis en sucursal',   puntos: 200, icono: 'ti-bottle'         },
  { id: 'internet-180',  nombre: '3 horas de internet gratis',    puntos: 300, icono: 'ti-device-desktop' },
  { id: 'kit-papeleria', nombre: 'Kit de papelería gratis',       puntos: 500, icono: 'ti-notebook'       },
];

// Sucursales físicas con coordenadas para Google Maps
export const SUCURSALES_CLIENTE = [
  { nombre: 'Sucursal Mitras',         dir: 'Av. Venustiano Carranza 1232, Mitras Centro',      lat: 25.6790, lng: -100.3735 },
  { nombre: 'Sucursal Santa Catarina', dir: 'Blvd. Díaz Ordaz 450, Santa Catarina',              lat: 25.6743, lng: -100.4593 },
  { nombre: 'Sucursal Cumbres',        dir: 'Av. Paseo de los Leones 2901, Cumbres 4to Sector', lat: 25.7291, lng: -100.3891 },
];
