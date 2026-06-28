import mongoose from 'mongoose';

const EmpleadoSchema = new mongoose.Schema({
  nombre:                 { type: String, required: true, maxlength: 100 },
  sucursal:               { type: String, enum: ['Simon Bolivar', 'Centro', 'Sureste'] },
  lider_id:               { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', default: null },
  coordinador_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', default: null },
  rol:                    { type: String, default: 'vendedor', maxlength: 30 },
  turnos:                 [{ type: String, enum: ['T1', 'T2', 'T3'] }],
  puntos_acumulados:      { type: Number, default: 0 },
  ventas_extraordinarias: { type: Number, default: 0 },
  nivel_bono:             { type: String, enum: ['ninguno', 'bronce', 'plata', 'oro'], default: 'ninguno' },
  activo:                 { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

export default mongoose.model('Empleado', EmpleadoSchema);
