// =============================================================
//  Script de un solo uso: crea o actualiza una cuenta de prueba
//  por cada rol restante (coordinador, lider, encargado, cliente)
//  para poder comparar qué panel ve cada uno.
//  Uso: node scripts/crearTestRoles.js
// =============================================================

import dotenv   from 'dotenv';
import mongoose from 'mongoose';
import Usuario  from '../src/models/Usuario.js';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);

const PASSWORD = 'TestRoles2026!';

const ROLES = [
  { correo: 'test.coordinador@i24h.test', nombre: 'Test Coordinador', cargo: 'coordinador', sucursales: ['Insurgentes'] },
  { correo: 'test.lider@i24h.test',       nombre: 'Test Lider',       cargo: 'lider',        sucursales: ['Insurgentes'] },
  { correo: 'test.encargado@i24h.test',   nombre: 'Test Encargado',   cargo: 'encargado',     sucursales: ['Insurgentes'] },
  { correo: 'test.cliente@i24h.test',     nombre: 'Test Cliente',     cargo: 'cliente',       sucursales: [] },
];

for (const { correo, nombre, cargo, sucursales } of ROLES) {
  const existente = await Usuario.findOne({ correo });

  if (existente) {
    existente.password  = PASSWORD;
    existente.cargo      = cargo;
    existente.sucursales = sucursales;
    existente.activo     = true;
    await existente.save();
    console.log(`✓ Actualizado: ${correo} (${cargo})`);
  } else {
    await Usuario.create({ correo, password: PASSWORD, nombre, cargo, sucursales });
    console.log(`✓ Creado: ${correo} (${cargo})`);
  }
}

await mongoose.disconnect();
