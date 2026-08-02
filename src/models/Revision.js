import mongoose from 'mongoose';

const ComparacionSchema = new mongoose.Schema({
  concepto:  { type: String, required: true },
  etiqueta:  { type: String },
  contador:  { type: Number, default: 0 },
  cobrado:   { type: Number, default: 0 },
  diferencia:{ type: Number, default: 0 },
  causa:     { type: String, trim: true, default: '' },
  cobrable:  { type: Boolean, default: false },
}, { _id: false });

const EventoAuditoriaSchema = new mongoose.Schema({
  evento:        { type: String, required: true },
  fecha:         { type: Date, default: Date.now },
  actor:         { type: String, trim: true },
  detalle:       { type: String, trim: true },
  valorAnterior: { type: mongoose.Schema.Types.Mixed },
  valorNuevo:    { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const RevisionSchema = new mongoose.Schema({
  ncaja:      { type: Number, required: true },
  sucursal:   { type: String, required: true },
  turno:      { type: String, trim: true },
  fecha:      { type: Date, required: true },
  operador:   { type: String, trim: true },

  colaboradores: [{ type: String, trim: true }],

  estado: {
    type: String,
    enum: ['pendiente', 'aprobada', 'diferencia_cobrable', 'seguimiento'],
    default: 'pendiente',
  },

  comparaciones: [ComparacionSchema],

  totalContador:   { type: Number, default: 0 },
  totalCobrado:    { type: Number, default: 0 },
  diferenciaTotal: { type: Number, default: 0 },
  tolerancia:      { type: Number, default: -20 },
  superaTolerancia:{ type: Boolean, default: false },

  corteCaja:           { type: mongoose.Schema.Types.ObjectId, ref: 'CorteCaja' },
  contadoresImpresora: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ContadorImpresora' }],

  observaciones: { type: String, trim: true, default: '' },
  historial:     [EventoAuditoriaSchema],
}, { timestamps: true });

RevisionSchema.index({ sucursal: 1, ncaja: 1 }, { unique: true });
RevisionSchema.index({ sucursal: 1, fecha: -1 });
RevisionSchema.index({ sucursal: 1, estado: 1 });

export default mongoose.model('Revision', RevisionSchema);
