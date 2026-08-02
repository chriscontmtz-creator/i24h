import mongoose from 'mongoose';

const LineaConteoSchema = new mongoose.Schema({
  codigo:     { type: Number, required: true },
  nombre:     { type: String, trim: true },
  categoria:  { type: String, trim: true },
  fisico:     { type: Number, required: true },
  esperado:   { type: Number, default: 0 },
  diferencia: { type: Number, default: 0 },

  corregido:         { type: Boolean, default: false },
  corregidoPor:      { type: String, trim: true },
  corregidoAt:       { type: Date },
  valorOriginal:     { type: Number },
  motivoCorreccion:  { type: String, trim: true },
}, { _id: false });

const ConteoFisicoSchema = new mongoose.Schema({
  sucursal:    { type: String, required: true },
  fecha:       { type: Date,   required: true },
  responsable: { type: String, required: true, trim: true },
  cubreDesde:  { type: Date,   required: true },
  cubreHasta:  { type: Date,   required: true },

  turnosCubiertos: [{
    ncaja:            { type: Number },
    turno:            { type: String },
    fecha:            { type: Date },
    tieneDiferencias: { type: Boolean, default: false },
  }],

  lineas: [LineaConteoSchema],

  totalProductos:  { type: Number, default: 0 },
  productosConDif: { type: Number, default: 0 },
  valorDiferencia: { type: Number, default: 0 },

  estado: {
    type: String,
    enum: ['en_proceso', 'completado', 'revisado'],
    default: 'en_proceso',
  },

  observaciones: { type: String, trim: true, default: '' },

  historial: [{
    evento:  { type: String },
    fecha:   { type: Date, default: Date.now },
    actor:   { type: String, trim: true },
    detalle: { type: String, trim: true },
  }],
}, { timestamps: true });

ConteoFisicoSchema.index({ sucursal: 1, fecha: -1 });
ConteoFisicoSchema.index({ sucursal: 1, estado: 1 });

export default mongoose.model('ConteoFisico', ConteoFisicoSchema);
