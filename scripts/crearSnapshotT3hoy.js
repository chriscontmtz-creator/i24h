// =============================================================
//  Script de prueba: crea el snapshot del corte de T3 de hoy
//  Simula lo que el cron hace automáticamente a las 05:05
//  Uso: node scripts/crearSnapshotT3hoy.js
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
    Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 11, 5, 0)
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
      turnoQueEntrega: 'T3',
      fechaCorte:      { $gte: new Date(fechaCorte.getTime() - 60 * 60 * 1000) },
    });

    await SnapshotCorte.create({
      sucursal:        suc.nombre,
      turnoQueEntrega: 'T3',
      turnoQueRecibe:  'T1',
      fechaCorte,
      productos:       prods.map(p => ({ nombre: p.nombre, stock: p.stock || 0 })),
    });

    const conStock = prods.filter(p => (p.stock || 0) > 0).length;
    console.log(`✓ ${suc.nombre}: ${prods.length} productos (${conStock} con stock > 0)`);
    total += prods.length;
  }

  console.log(`\n✓ Listo — ${SUCURSALES.length} sucursales · ${total} registros en total`);
  console.log('  T1 ya puede abrir la bitácora y verá el stock del corte de T3.\n');

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
