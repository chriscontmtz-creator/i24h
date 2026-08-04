import cron         from 'node-cron';
import Producto      from '../models/Producto.js';
import SnapshotCorte from '../models/SnapshotCorte.js';

const SUCURSALES = [
  'Simón Bolívar', 'Insurgentes', 'Antígona', 'Lincoln Oxxo',
  'Lincoln 2', 'Ruiz Cortines', 'Rodas', 'Cuauhtémoc', 'Ordóñez',
];

const SUCURSAL_DB = {
  'Simón Bolívar': 'SimonBolivar',
  'Insurgentes':   'Insurgentes',
  'Antígona':      'Antigona',
  'Lincoln Oxxo':  'LincolnOxxo',
  'Lincoln 2':     'LincolnDos',
  'Ruiz Cortines': 'RuizCortines',
  'Rodas':         'Rodas',
  'Cuauhtémoc':    'Cuauhtemoc',
  'Ordóñez':       'Ordonez',
};

async function tomarSnapshot(turnoQueEntrega, turnoQueRecibe) {
  const ahora = new Date();
  console.log(`[cron-corte] Snapshot ${turnoQueEntrega}→${turnoQueRecibe} iniciado ${ahora.toLocaleTimeString('es-MX')}`);

  for (const suc of SUCURSALES) {
    try {
      const dbKey  = SUCURSAL_DB[suc] || suc;
      const prods  = await Producto.find(
        { sucursal: dbKey, nombre: { $not: /^Nuevo Producto/ } }
      ).select('nombre stock').lean();

      await SnapshotCorte.create({
        sucursal:        suc,
        turnoQueEntrega,
        turnoQueRecibe,
        fechaCorte:      ahora,
        productos:       prods.map(p => ({ nombre: p.nombre, stock: p.stock ?? 0 })),
      });

      console.log(`[cron-corte] ${suc}: ${prods.length} productos guardados`);
    } catch (err) {
      console.error(`[cron-corte] Error en ${suc}:`, err.message);
    }
  }
}

export function iniciarCronCortes() {
  // Sync unificado de sucursal arranca 07:10 (tarda ~5-6 min) → snapshot de respaldo 07:20 → T1 lo usa
  cron.schedule('20 7 * * *', () => tomarSnapshot('T3', 'T1'), {
    timezone: 'America/Mexico_City',
  });

  // Sync unificado arranca 15:10 → snapshot de respaldo 15:20 → T2 lo usa
  cron.schedule('20 15 * * *', () => tomarSnapshot('T1', 'T2'), {
    timezone: 'America/Mexico_City',
  });

  // Sync unificado arranca 21:50 → snapshot de respaldo 22:00 → T3 lo usa
  cron.schedule('0 22 * * *', () => tomarSnapshot('T2', 'T3'), {
    timezone: 'America/Mexico_City',
  });

  console.log('[cron-corte] Activo: 07:20, 15:20, 22:00 (hora México)');
}
