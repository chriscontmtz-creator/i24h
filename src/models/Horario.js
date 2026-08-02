import { Schema, model } from 'mongoose';

// =========================
// CeldaSchema
// =========================
const CeldaSchema = new Schema(
  {
    dia: {
      type: Number,
      min: 0,
      max: 6,
    },

    empleados: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Usuario',
      },
    ],

    estado: {
      type: String,
      enum: ['normal', 'cambio', 'conflicto', 'doble', 'vacio'],
      default: 'normal',
    },

    indicacion: {
      type: String,
      default: '',
    },
  },
  { _id: false }
);

// =========================
// HorarioSchema
// =========================
const HorarioSchema = new Schema({
  sucursal: {
    type: String,
    required: true,
    enum: [
      'Simón Bolívar',
      'Insurgentes',
      'Antígona',
      'Lincoln Oxxo',
      'Lincoln 2',
      'Ruiz Cortines',
      'Rodas',
      'Cuauhtémoc',
      'Ordóñez',
    ],
  },

  semana: {
    type: String,
    required: true,
  },

  estado: {
    type: String,
    enum: ['borrador', 'publicado'],
    default: 'borrador',
  },

  turnos: {
    T1: {
      type: [CeldaSchema],
      default: [],
    },
    T2: {
      type: [CeldaSchema],
      default: [],
    },
    T3: {
      type: [CeldaSchema],
      default: [],
    },
  },

  creadoEn: {
    type: Date,
    default: Date.now,
  },

  actualizadoEn: {
    type: Date,
    default: Date.now,
  },
});

// Evita duplicados de sucursal + semana
HorarioSchema.index(
  { sucursal: 1, semana: 1 },
  { unique: true }
);

export default model('Horario', HorarioSchema);