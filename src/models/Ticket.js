import mongoose from 'mongoose';

const LineaTicketSchema = new mongoose.Schema({
  tipo:     { type: Number },
  detalle:  { type: String, trim: true },
  importe:  { type: Number, default: 0 },
  cantidad: { type: Number, default: 0 },
  pc:       { type: String, trim: true, default: '' },
  hora:     { type: String },
}, { _id: false });

const TicketSchema = new mongoose.Schema({
  nticket:      { type: Number, required: true },
  fecha:        { type: Date, required: true },
  ncaja:        { type: Number },
  importeTotal: { type: Number, default: 0 },
  anulado:      { type: Boolean, default: false },
  lineas:       [LineaTicketSchema],
  sucursal:     { type: String, required: true },
}, { timestamps: true });

TicketSchema.index({ sucursal: 1, nticket: 1 }, { unique: true });
TicketSchema.index({ sucursal: 1, fecha: -1 });
TicketSchema.index({ sucursal: 1, ncaja: 1 });

export default mongoose.model('Ticket', TicketSchema);
