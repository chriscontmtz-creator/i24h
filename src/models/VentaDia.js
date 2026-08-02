import mongoose from 'mongoose';

// Un ítem individual de la venta del día
const ItemSchema = new mongoose.Schema({
  nombre:         { type: String, required: true, trim: true },
  categoria:      { type: String, enum: ['Novedades', 'Papelería', 'Snack', 'Otro'], default: 'Otro' },
  unidades:       { type: Number, required: true, min: 0 },
  precioUnitario: { type: Number, required: true, min: 0 },
  subtotal:       { type: Number },        // calculado en el pre-save del padre
}, { _id: true });

// Entrada de auditoría cuando alguien corrige un registro
const HistorialCambioSchema = new mongoose.Schema({
  fecha:        { type: Date, default: Date.now },
  modificadoPor:{ type: String },
  nota:         { type: String },
  snapshotItems:{ type: mongoose.Schema.Types.Mixed },   // copia del estado anterior
}, { _id: false });

const VentaDiaSchema = new mongoose.Schema({
  // Llave de negocio única: qué día y en qué sucursal
  fecha:     { type: Date, required: true },
  sucursal:  {
    type: String,
    required: true,
    enum: [
      'Simón Bolívar', 'Insurgentes', 'Antígona',
      'Lincoln Oxxo',  'Lincoln 2',   'Ruiz Cortines',
      'Rodas',         'Cuauhtémoc',  'Ordóñez',
    ],
  },

  // Productos vendidos ese día
  items: { type: [ItemSchema], default: [] },

  // Total calculado automáticamente
  totalGeneral: { type: Number, default: 0 },

  // Meta
  cerradoPor:   { type: String },
  nota:         { type: String, trim: true },     // nota libre / motivo de corrección
  esCorreccion: { type: Boolean, default: false },
  correccionDe: { type: mongoose.Schema.Types.ObjectId, ref: 'VentaDia', default: null },

  // Historial de cambios (para auditoría)
  historial: { type: [HistorialCambioSchema], default: [] },
}, {
  timestamps: { createdAt: 'creadoEn', updatedAt: 'actualizadoEn' },
});

// Índice único: un registro por sucursal por día
VentaDiaSchema.index({ fecha: 1, sucursal: 1 }, { unique: true });

// Calcula subtotales e ítems antes de guardar (Mongoose 7+ — async, sin next)
VentaDiaSchema.pre('save', async function () {
  let total = 0;
  this.items.forEach(item => {
    item.subtotal = Math.round((item.unidades || 0) * (item.precioUnitario || 0) * 100) / 100;
    total += item.subtotal;
  });
  this.totalGeneral = Math.round(total * 100) / 100;
});

// Recalcula en findOneAndUpdate cuando se reemplazan items
VentaDiaSchema.pre('findOneAndUpdate', async function () {
  const update = this.getUpdate();
  if (update && update.items) {
    let total = 0;
    update.items.forEach(item => {
      item.subtotal = Math.round((item.unidades || 0) * (item.precioUnitario || 0) * 100) / 100;
      total += item.subtotal;
    });
    update.totalGeneral = Math.round(total * 100) / 100;
  }
});

export default mongoose.model('VentaDia', VentaDiaSchema);
