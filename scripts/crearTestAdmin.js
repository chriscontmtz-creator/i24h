// =============================================================
//  Script de un solo uso: crea o actualiza una cuenta ADMIN de
//  prueba (test.admin@i24h.test) para QA, sin tocar el admin real.
//  Uso: node scripts/crearTestAdmin.js
// =============================================================

import dotenv   from 'dotenv';
import mongoose from 'mongoose';
import Usuario  from '../src/models/Usuario.js';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);

const correo   = 'test.admin@i24h.test';
const password = 'TestRoles2026!';
const nombre   = 'Test Admin';

const existente = await Usuario.findOne({ correo });

if (existente) {
  existente.password = password;
  existente.cargo    = 'admin';
  existente.activo   = true;
  await existente.save();
  console.log('✓ Cuenta test.admin actualizada correctamente.');
} else {
  await Usuario.create({ correo, password, nombre, cargo: 'admin' });
  console.log('✓ Cuenta test.admin creada correctamente.');
}

await mongoose.disconnect();
