import mongoose from 'mongoose';

const productoSnapSchema = new mongoose.Schema({
  nombre: { type: String },
  stock:  { type: Number, default: 0 },
}, { _id: false });

const snapshotCorteSchema = new mongoose.Schema({
  sucursal:        { type: String, required: true },
  turnoQueEntrega: { type: String, required: true }, // 'T1', 'T2', 'T3'
  turnoQueRecibe:  { type: String, required: true }, // 'T2', 'T3', 'T1'
  fechaCorte:      { type: Date, default: Date.now },
  productos:       [productoSnapSchema],
}, { timestamps: true });

snapshotCorteSchema.index({ sucursal: 1, fechaCorte: -1 });

export default mongoose.model('SnapshotCorte', snapshotCorteSchema);
