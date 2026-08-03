// =============================================================
//  Script de un solo uso: crea o actualiza el usuario de prueba
//  para revisar el dashboard (/dashboard) como empleado.
//  Uso: node scripts/crearTestEmpleado.js
// =============================================================

import dotenv   from 'dotenv';
import mongoose from 'mongoose';
import Usuario  from '../src/models/Usuario.js';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);

const correo      = 'test.dashboard@i24h.test';
const password    = 'Dashboard2026Test!';
const nombre      = 'Test Dashboard';
const cargo       = 'colaborador';
const sucursales  = ['Insurgentes'];

const existente = await Usuario.findOne({ correo });

if (existente) {
  existente.password   = password;
  existente.cargo       = cargo;
  existente.sucursales  = sucursales;
  existente.activo      = true;
  await existente.save();
  console.log('✓ Usuario de prueba actualizado correctamente.');
} else {
  await Usuario.create({ correo, password, nombre, cargo, sucursales });
  console.log('✓ Usuario de prueba creado correctamente.');
}

await mongoose.disconnect();
