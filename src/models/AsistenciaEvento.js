import mongoose from 'mongoose';

// Cada documento es UNA marcación (no un par entrada+salida). Un empleado
// puede tener varios eventos el mismo día, incluso en distintas sucursales
// (ej. un líder que cierra en una sucursal y abre en otra el mismo turno).
const AsistenciaEventoSchema = new mongoose.Schema({
  empleado_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Usuario',
    required: true,
  },
  sucursal: {
    type:     String,
    required: true,
  },
  tipo: {
    type:     String,
    enum:     ['entrada', 'salida', 'inicio_comida', 'fin_comida'],
    required: true,
  },
  // Turno vigente ese día/sucursal según Horario, si aplica. Null si el
  // empleado marcó en una sucursal/día donde no tiene turno asignado.
  turno: {
    type:    String,
    enum:    ['T1', 'T2', 'T3', null],
    default: null,
  },
  timestamp: {
    type:    Date,
    default: Date.now,
  },
  // Quién escaneó/confirmó esta marcación (Encargado/Líder/Coordinador/Admin).
  // Null en eventos históricos del kiosco (auto-servicio, sin confirmante).
  confirmado_por: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Usuario',
    default: null,
  },
  // true si el propio dueño del evento se autoconfirmó por no tener a nadie
  // más con rango disponible para escanearle en ese momento.
  auto_confirmado: {
    type:    Boolean,
    default: false,
  },
}, { timestamps: false });

AsistenciaEventoSchema.index({ empleado_id: 1, timestamp: -1 });
AsistenciaEventoSchema.index({ sucursal: 1, timestamp: -1 });

export default mongoose.model('AsistenciaEvento', AsistenciaEventoSchema);
