import Usuario from '../models/Usuario.js';

// Las 9 sucursales reales de la cadena — fuente única para saber qué
// sucursales existen. El nombre debe coincidir exactamente con lo que se
// guarda en Usuario.sucursales (mismo formato que los checkboxes de
// asignación en panel.hbs) para que el filtro por usuario funcione.
export const TODAS_SUCURSALES = [
  'Simón Bolívar', 'Insurgentes', 'Antígona', 'Lincoln Oxxo', 'Lincoln 2',
  'Ruiz Cortines', 'Rodas', 'Cuauhtémoc', 'Ordóñez',
];

// Sucursales cuyo CyberPlanet ya corre I24H-sync y por lo tanto tienen datos
// reales de ventas en Mongo. Las demás existen en el sistema (empleados,
// horarios, bitácoras...) pero todavía no reportan ventas — las secciones que
// muestran cifras de venta (Ventas, top productos, alertas) deben mostrarlas
// en 0 en vez de datos de ejemplo. Para conectar una sucursal nueva cuando
// arranque su sync, solo agrégala a esta lista.
export const SUCURSALES_CONECTADAS = ['Simón Bolívar'];

export function sucursalConectada(sucursal) {
  return SUCURSALES_CONECTADAS.includes(sucursal);
}

// Sucursales que puede VER/consultar este usuario. Admin siempre ve las 9;
// cualquier otro cargo (coordinador, lider, encargado, colaborador) solo ve
// las que tiene asignadas en su perfil — si no tiene ninguna, no ve ninguna
// (sin fallback a "todas").
export async function sucursalesDeUsuario(usuarioSesion) {
  if (usuarioSesion.cargo === 'admin') return TODAS_SUCURSALES;
  const perfil = await Usuario.findById(usuarioSesion.id).select('sucursales').lean();
  return perfil?.sucursales || [];
}

// true si el usuario tiene permitida esa sucursal (admin siempre true).
export async function sucursalPermitida(usuarioSesion, sucursal) {
  if (usuarioSesion.cargo === 'admin') return true;
  const permitidas = await sucursalesDeUsuario(usuarioSesion);
  return permitidas.includes(sucursal);
}
