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
  // T3 corte 05:00 AM → snapshot 05:05 AM → T1 lo usa
  cron.schedule('5 5 * * *', () => tomarSnapshot('T3', 'T1'), {
    timezone: 'America/Mexico_City',
  });

  // T1 corte 15:00 PM → snapshot 15:05 PM → T2 lo usa
  cron.schedule('5 15 * * *', () => tomarSnapshot('T1', 'T2'), {
    timezone: 'America/Mexico_City',
  });

  // T2 corte 21:40 PM → snapshot 21:45 PM → T3 lo usa
  cron.schedule('45 21 * * *', () => tomarSnapshot('T2', 'T3'), {
    timezone: 'America/Mexico_City',
  });

  console.log('[cron-corte] Activo: 05:05, 15:05, 21:45 (hora México)');
}
