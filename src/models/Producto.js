import mongoose from 'mongoose';

const ProductoSchema = new mongoose.Schema({
  codigo:       { type: Number, required: true },
  nombre:       { type: String, required: true, trim: true },
  precio:       { type: Number, default: 0 },
  codCategoria: { type: Number, required: true },
  stock:        { type: Number, default: 0 },
  minimo:       { type: Number, default: 1 },
  sucursal:     { type: String, required: true },
}, { timestamps: true });

ProductoSchema.index({ sucursal: 1, codigo: 1 }, { unique: true });

export default mongoose.model('Producto', ProductoSchema);
