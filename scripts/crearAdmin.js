// =============================================================
//  Script de un solo uso: crea o actualiza la cuenta admin
//  Uso: node scripts/crearAdmin.js
// =============================================================

import dotenv   from 'dotenv';
import mongoose from 'mongoose';
import Usuario  from '../src/models/Usuario.js';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);

const correo   = 'chriscontmtz@gmail.com';
const password = '4419790625Cc';

const existente = await Usuario.findOne({ correo });

if (existente) {
  // Ya existe — solo actualiza la contraseña
  existente.password = password;
  existente.cargo    = 'admin';
  existente.activo   = true;
  await existente.save();
  console.log('✓ Contraseña de admin actualizada correctamente.');
} else {
  // No existe — lo crea desde cero
  await Usuario.create({ correo, password, nombre: 'Admin', cargo: 'admin' });
  console.log('✓ Cuenta admin creada correctamente.');
}

await mongoose.disconnect();
