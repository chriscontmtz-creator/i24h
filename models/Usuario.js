// =============================================================
//  models/Usuario.js
//  Modelo de Mongoose para todos los usuarios del sistema.
//  Cubre tanto empleados (admin, coordinador, etc.) como clientes.
// =============================================================

import mongoose      from 'mongoose';
import bcrypt        from 'bcryptjs';
import { randomUUID } from 'crypto';

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
      ref:     'Usuario',
      default: null,
    },

    // ID único para el código QR del cliente — se genera una sola vez y nunca cambia
    qrId: {
      type:   String,
      unique: true,
      sparse: true,  // Permite null en cuentas antiguas sin romper el índice único
    },

    // Historial de visitas y compras del cliente
    historial: [
      {
        fecha:    { type: Date,   default: Date.now },
        monto:    { type: Number, required: true },
        concepto: { type: String, default: 'Uso de internet' },
        sucursal: { type: String, default: 'Sucursal Principal' },
      },
    ],

    // Registro de recompensas canjeadas
    canjes: [
      {
        fecha:        { type: Date,   default: Date.now },
        recompensa:   { type: String, required: true },
        puntosUsados: { type: Number, required: true },
      },
    ],
  },
  {
    // Agrega automáticamente los campos "createdAt" y "updatedAt"
    timestamps: { createdAt: 'fechaCreacion', updatedAt: 'fechaActualizacion' },
  }
);

// -------------------------------------------------------------
//  MIDDLEWARE — se ejecuta antes de guardar en la base de datos
// -------------------------------------------------------------

UsuarioEsquema.pre('save', async function () {
  // Genera el qrId una sola vez si todavía no tiene uno
  if (!this.qrId) this.qrId = randomUUID();

  // Solo encripta si la contraseña fue modificada
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
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
