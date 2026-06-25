// =============================================================
//  models/Usuario.js
//  Modelo de Mongoose para todos los usuarios del sistema.
//  Cubre tanto empleados (admin, coordinador, etc.) como clientes.
// =============================================================

import mongoose from 'mongoose';
import bcrypt   from 'bcryptjs';

// -------------------------------------------------------------
//  ESQUEMA — define los campos y reglas de cada usuario
// -------------------------------------------------------------
const UsuarioEsquema = new mongoose.Schema(
  {
    // Correo único que funciona como identificador de login
    correo: {
      type:      String,
      required:  [true, 'El correo es obligatorio'],
      unique:    true,
      lowercase: true,   // Se guarda siempre en minúsculas
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, 'Formato de correo inválido'],
    },

    // Contraseña — se guarda encriptada, nunca en texto plano
    password: {
      type:      String,
      required:  [true, 'La contraseña es obligatoria'],
      minlength: [6, 'La contraseña debe tener al menos 6 caracteres'],
      select:    false,  // No se devuelve en consultas a menos que se pida explícitamente
    },

    // Nombre para mostrar en el panel
    nombre: {
      type:    String,
      trim:    true,
      default: 'Usuario',
    },

    // Tipo de usuario — determina los permisos en el panel
    // "cliente" es para los socios del cibercafé
    // Los demás son cargos internos de empleados
    cargo: {
      type:    String,
      enum:    ['admin', 'coordinador', 'lider', 'encargado', 'colaborador', 'cliente'],
      default: 'cliente',
    },

    // Puntos acumulados (aplica principalmente a clientes)
    puntos: {
      type:    Number,
      default: 0,
      min:     0,
    },

    // Si la cuenta está activa o fue dada de baja
    activo: {
      type:    Boolean,
      default: true,
    },

    // Código de verificación usado al registrarse (solo clientes)
    // Se guarda para auditoría
    codigoUsado: {
      type:    String,
      default: null,
    },

    // Empleado que creó esta cuenta (referencia a otro Usuario)
    creadoPor: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Usuario',  // Apunta al mismo modelo
      default: null,
    },
  },
  {
    // Agrega automáticamente los campos "createdAt" y "updatedAt"
    timestamps: { createdAt: 'fechaCreacion', updatedAt: 'fechaActualizacion' },
  }
);

// -------------------------------------------------------------
//  MIDDLEWARE — se ejecuta antes de guardar en la base de datos
// -------------------------------------------------------------

// Encripta la contraseña automáticamente cuando se crea o modifica
UsuarioEsquema.pre('save', async function (siguiente) {
  // Solo encripta si la contraseña fue modificada (evita re-encriptar en otros cambios)
  if (!this.isModified('password')) return siguiente();

  this.password = await bcrypt.hash(this.password, 10);
  siguiente();
});

// -------------------------------------------------------------
//  MÉTODOS — funciones disponibles en cada documento Usuario
// -------------------------------------------------------------

// Compara una contraseña en texto plano con la encriptada guardada
UsuarioEsquema.methods.verificarPassword = async function (passwordTextoPlano) {
  return bcrypt.compare(passwordTextoPlano, this.password);
};

// -------------------------------------------------------------
//  EXPORTAR EL MODELO
// -------------------------------------------------------------
export default mongoose.model('Usuario', UsuarioEsquema);
