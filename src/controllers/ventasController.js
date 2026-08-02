import VentaDia from '../models/VentaDia.js';

// Normaliza una fecha a medianoche UTC para comparaciones
function soloFecha(d) {
  const f = new Date(d);
  f.setUTCHours(0, 0, 0, 0);
  return f;
}

// ──────────────────────────────────────────────────────────────
//  GET /api/ventas/registros
//  Query: sucursal, desde (YYYY-MM-DD), hasta (YYYY-MM-DD)
// ──────────────────────────────────────────────────────────────
export async function listarRegistros(req, res) {
  try {
    const { sucursal, desde, hasta } = req.query;
    const filtro = {};

    if (sucursal && sucursal !== 'todas') filtro.sucursal = sucursal;

    if (desde || hasta) {
      filtro.fecha = {};
      if (desde) filtro.fecha.$gte = soloFecha(desde);
      if (hasta) {
        const h = soloFecha(hasta);
        h.setUTCHours(23, 59, 59, 999);
        filtro.fecha.$lte = h;
      }
    }

    const registros = await VentaDia
      .find(filtro)
      .sort({ fecha: -1 })
      .select('-historial');   // historial se omite en la lista, solo en detalle

    res.json(registros);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener registros', detalle: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
//  GET /api/ventas/registros/:id
// ──────────────────────────────────────────────────────────────
export async function obtenerRegistro(req, res) {
  try {
    const registro = await VentaDia.findById(req.params.id);
    if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(registro);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener registro', detalle: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
//  POST /api/ventas/registros
//  Crea un registro nuevo para un día/sucursal
//  Body: { fecha, sucursal, items:[{nombre,categoria,unidades,precioUnitario}], nota }
// ──────────────────────────────────────────────────────────────
export async function crearRegistro(req, res) {
  try {
    const { fecha, sucursal, items = [], nota } = req.body;
    if (!fecha || !sucursal) return res.status(400).json({ error: 'fecha y sucursal son obligatorios' });

    const nuevo = new VentaDia({
      fecha:      soloFecha(fecha),
      sucursal,
      items,
      nota,
      cerradoPor: req.session?.usuario?.nombre || 'Sistema',
    });

    await nuevo.save();
    res.status(201).json(nuevo);
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ error: 'Ya existe un registro para esa fecha y sucursal' });
    res.status(500).json({ error: 'Error al crear registro', detalle: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
//  PUT /api/ventas/registros/:id
//  Reemplaza los ítems del día (corrección completa)
//  Guarda el estado anterior en historial
//  Body: { items:[...], nota }
// ──────────────────────────────────────────────────────────────
export async function corregirRegistro(req, res) {
  try {
    const { items, nota } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items debe ser un array' });

    const original = await VentaDia.findById(req.params.id);
    if (!original) return res.status(404).json({ error: 'Registro no encontrado' });

    // Snapshot del estado anterior al historial
    original.historial.push({
      modificadoPor: req.session?.usuario?.nombre || 'Sistema',
      nota: nota || 'Corrección sin nota',
      snapshotItems: original.items.toObject ? original.items.toObject() : original.items,
    });

    original.items        = items;
    original.nota         = nota || original.nota;
    original.esCorreccion = true;
    original.cerradoPor   = req.session?.usuario?.nombre || 'Sistema';

    await original.save();   // pre-save recalcula totalGeneral
    res.json(original);
  } catch (err) {
    res.status(500).json({ error: 'Error al corregir registro', detalle: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
//  PATCH /api/ventas/registros/:id/items
//  Agrega, modifica o elimina ítems individuales sin reemplazar todo
//  Body: { accion: 'agregar'|'editar'|'eliminar', item: {...}, itemId }
// ──────────────────────────────────────────────────────────────
export async function patchItem(req, res) {
  try {
    const { accion, item, itemId } = req.body;
    const registro = await VentaDia.findById(req.params.id);
    if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });

    // Guarda snapshot antes de modificar
    registro.historial.push({
      modificadoPor: req.session?.usuario?.nombre || 'Sistema',
      nota: `Patch ítem (${accion})`,
      snapshotItems: registro.items.map(i => ({ ...i.toObject() })),
    });

    if (accion === 'agregar') {
      registro.items.push(item);
    } else if (accion === 'editar') {
      const idx = registro.items.findIndex(i => i._id.toString() === itemId);
      if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado' });
      Object.assign(registro.items[idx], item);
    } else if (accion === 'eliminar') {
      registro.items = registro.items.filter(i => i._id.toString() !== itemId);
    } else {
      return res.status(400).json({ error: 'accion inválida. Usa: agregar | editar | eliminar' });
    }

    registro.esCorreccion = true;
    await registro.save();
    res.json(registro);
  } catch (err) {
    res.status(500).json({ error: 'Error al modificar ítem', detalle: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
//  GET /api/ventas/resumen-bd?sucursal=&desde=&hasta=
//  Agrega los registros de MongoDB para el dashboard
//  (reemplazará eventualmente a los datos del JSON mock)
// ──────────────────────────────────────────────────────────────
export async function resumenBD(req, res) {
  try {
    const { sucursal, desde, hasta } = req.query;
    const match = {};

    if (sucursal && sucursal !== 'todas') match.sucursal = sucursal;
    if (desde || hasta) {
      match.fecha = {};
      if (desde) match.fecha.$gte = soloFecha(desde);
      if (hasta) {
        const h = soloFecha(hasta);
        h.setUTCHours(23, 59, 59, 999);
        match.fecha.$lte = h;
      }
    }

    const [agg] = await VentaDia.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$sucursal',
          total: { $sum: '$totalGeneral' },
          dias:  { $sum: 1 },
          items: { $push: '$items' },
        },
      },
      { $sort: { total: -1 } },
    ]);

    // Si no hay datos en BD todavía, devuelve vacío claro
    const resultado = await VentaDia.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$sucursal',
          total: { $sum: '$totalGeneral' },
          dias:  { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const totalGeneral = resultado.reduce((s, r) => s + r.total, 0);

    res.json({
      totalGeneral,
      porSucursal: resultado,
      registros:   resultado.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error en resumen', detalle: err.message });
  }
}
