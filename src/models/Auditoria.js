import mongoose from 'mongoose';

const AuditoriaSchema = new mongoose.Schema({
  empleado_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true },
  fecha:            { type: Date, default: () => new Date() },
  ventas:           { type: Number, min: 1, max: 10, required: true },
  actitud:          { type: Number, min: 1, max: 10, required: true },
  cumplimiento:     { type: Number, min: 1, max: 10, required: true },
  asistencia:       { type: Number, min: 1, max: 10, required: true },
  limpieza:         { type: Number, min: 1, max: 10, required: true },
  atencion_cliente: { type: Number, min: 1, max: 10, required: true },
  eficiencia:       { type: Number, min: 1, max: 10, required: true },
  puntos_otorgados: { type: Number, default: null },
  lider_auditor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', default: null },
});

AuditoriaSchema.virtual('promedio').get(function () {
  const s = this.ventas + this.actitud + this.cumplimiento + this.asistencia
          + this.limpieza + this.atencion_cliente + this.eficiencia;
  return parseFloat((s / 7).toFixed(2));
});

AuditoriaSchema.set('toJSON',   { virtuals: true });
AuditoriaSchema.set('toObject', { virtuals: true });

export default mongoose.model('Auditoria', AuditoriaSchema);
