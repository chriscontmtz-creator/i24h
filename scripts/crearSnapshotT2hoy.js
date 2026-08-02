// =============================================================
//  Script de prueba: crea el snapshot del corte de T2 de hoy
//  Simula lo que el cron hace automáticamente a las 21:45
//  Uso: node scripts/crearSnapshotT2hoy.js
// =============================================================

import dotenv        from 'dotenv';
import mongoose      from 'mongoose';
import Producto      from '../src/models/Producto.js';
import SnapshotCorte from '../src/models/SnapshotCorte.js';

dotenv.config();

const SUCURSALES = [
  { nombre: 'Simón Bolívar', db: 'SimonBolivar' },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: 'i24h' });
  console.log('✓ Conectado a MongoDB\n');

  const ahora = new Date();
  const fechaCorte = new Date(
    Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1, 3, 45, 0)
  );

  let total = 0;

  for (const suc of SUCURSALES) {
    const prods = await Producto.find(
      { sucursal: suc.db, nombre: { $not: /^Nuevo Producto/ } }
    ).select('nombre stock').lean();

    if (prods.length === 0) {
      console.log(`⚠  ${suc.nombre}: sin productos en BD — snapshot vacío guardado`);
    }

    await SnapshotCorte.deleteOne({
      sucursal:        suc.nombre,
      turnoQueEntrega: 'T2',
      fechaCorte:      { $gte: new Date(fechaCorte.getTime() - 60 * 60 * 1000) },
    });

    await SnapshotCorte.create({
      sucursal:        suc.nombre,
      turnoQueEntrega: 'T2',
      turnoQueRecibe:  'T3',
      fechaCorte,
      productos:       prods.map(p => ({ nombre: p.nombre, stock: p.stock || 0 })),
    });

    const conStock = prods.filter(p => (p.stock || 0) > 0).length;
    console.log(`✓ ${suc.nombre}: ${prods.length} productos (${conStock} con stock > 0)`);
    total += prods.length;
  }

  console.log(`\n✓ Listo — ${SUCURSALES.length} sucursales · ${total} registros en total`);
  console.log('  T3 ya puede abrir la bitácora y verá el stock del corte de T2.\n');

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
