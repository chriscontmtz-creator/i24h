// Modal de corrección de ventas — admin / coordinador
// Operaciones: cargar ventas del día, editar ítem, agregar ítem, eliminar ítem,
//              crear registro si no existe, historial de auditoría
// API: GET/POST/PATCH  /api/ventas/registros[/:id/items]

(function () {
  'use strict';

  // ── Referencias DOM ──────────────────────────────────────────────────
  var overlay, inputFecha, selSuc, tbody, estadoEl, actionsBar, regBadge, regInfo,
      footTotalEl, histWrap, addForm, addNombre, addCat, addUds, addPrecio, addSub;

  // ── Estado local ─────────────────────────────────────────────────────
  var registroActual = null;

  // ── Init ─────────────────────────────────────────────────────────────
  function init() {
    overlay     = document.getElementById('mcor-overlay');
    if (!overlay) return;                     // modal no presente en esta página

    inputFecha  = document.getElementById('mcor-fecha');
    selSuc      = document.getElementById('mcor-sucursal');
    tbody       = document.getElementById('mcor-tbody');
    estadoEl    = document.getElementById('mcor-estado');
    actionsBar  = document.getElementById('mcor-actions-bar');
    regBadge    = document.getElementById('mcor-reg-badge');
    regInfo     = document.getElementById('mcor-reg-info');
    footTotalEl = document.getElementById('mcor-foot-total');
    histWrap    = document.getElementById('mcor-historial');
    addForm     = document.getElementById('mcor-add-form');
    addNombre   = document.getElementById('mcor-add-nombre');
    addCat      = document.getElementById('mcor-add-cat');
    addUds      = document.getElementById('mcor-add-uds');
    addPrecio   = document.getElementById('mcor-add-precio');
    addSub      = document.getElementById('mcor-add-sub');

    // Botones fijos
    document.getElementById('mcor-btn-cargar')?.addEventListener('click', cargarVentas);
    document.getElementById('mcor-close')?.addEventListener('click', cerrarModal);
    document.getElementById('mcor-btn-cerrar2')?.addEventListener('click', cerrarModal);

    // Cerrar al hacer clic fuera del contenedor
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) cerrarModal();
    });

    // Cerrar con Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) cerrarModal();
    });

    // Subtotal live en el formulario de agregar
    if (addUds)    addUds.addEventListener('input',   recalcAddSub);
    if (addPrecio) addPrecio.addEventListener('input', recalcAddSub);
  }

  // El script carga al final del body — DOMContentLoaded ya disparó
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Abrir / cerrar ───────────────────────────────────────────────────
  window.abrirModalCorreccion = function () {
    if (!overlay) init();
    if (!overlay) return;
    overlay.classList.remove('hidden');
    // Fecha de hoy por defecto
    if (inputFecha && !inputFecha.value)
      inputFecha.value = new Date().toISOString().split('T')[0];
    resetModal();
  };

  function cerrarModal() {
    overlay?.classList.add('hidden');
    registroActual = null;
    resetModal();
  }

  function resetModal() {
    setEstado('');
    setTbody(filaVacia('Selecciona una fecha y sucursal para cargar las ventas.'));
    actionsBar?.classList.add('hidden');
    histWrap?.classList.add('hidden');
    addForm?.classList.add('hidden');
    setFooterTotal(null);
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  function setEstado(msg, tipo) {
    if (!estadoEl) return;
    estadoEl.textContent = msg || '';
    estadoEl.className   = 'mcor-estado' + (msg ? ' ' + (tipo || '') : ' hidden');
  }

  function setTbody(html) { if (tbody) tbody.innerHTML = html; }

  function setFooterTotal(val) {
    if (!footTotalEl) return;
    footTotalEl.innerHTML = val === null
      ? 'Total del día: <strong>—</strong>'
      : 'Total del día: <strong>' + fmtMXN(val) + '</strong>';
  }

  function fmtMXN(val) {
    return '$' + Number(val || 0).toLocaleString('es-MX',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function filaVacia(msg) {
    return '<tr><td colspan="7" class="mcor-fila-vacia">' + escHtml(msg) + '</td></tr>';
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function recalcAddSub() {
    var uds    = parseFloat(addUds?.value)    || 0;
    var precio = parseFloat(addPrecio?.value) || 0;
    if (addSub) addSub.textContent = fmtMXN(uds * precio);
  }

  // ── Cargar ventas del día ─────────────────────────────────────────────
  async function cargarVentas() {
    var fecha = inputFecha?.value;
    var suc   = selSuc?.value;
    if (!fecha || !suc) {
      setEstado('Selecciona una fecha y una sucursal primero.', 'error');
      return;
    }

    setEstado('Cargando ventas…', 'loading');
    setTbody(filaVacia('Cargando…'));
    actionsBar?.classList.add('hidden');
    histWrap?.classList.add('hidden');
    addForm?.classList.add('hidden');
    setFooterTotal(null);

    try {
      var resp = await fetch(
        '/api/ventas/registros?sucursal=' + encodeURIComponent(suc) +
        '&desde=' + fecha + '&hasta=' + fecha
      );
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var lista = await resp.json();

      if (!lista.length) {
        // No existe registro para ese día/sucursal — ofrecer crearlo
        registroActual = null;
        setEstado('');
        renderNoExiste(fecha, suc);
        return;
      }

      registroActual = lista[0];
      setEstado('');
      renderAccionsBar(registroActual);
      renderTabla(registroActual);
      renderHistorial(registroActual.historial || []);
    } catch (err) {
      setEstado('Error de conexión con el servidor.', 'error');
      setTbody(filaVacia('—'));
    }
  }

  // ── Estado "sin registro" con opción de crear ─────────────────────────
  function renderNoExiste(fecha, suc) {
    setTbody(
      '<tr><td colspan="7" class="mcor-fila-vacia" style="padding:32px">' +
        '<div style="margin-bottom:10px"><i class="ti ti-file-off" style="font-size:1.6rem;opacity:.4"></i></div>' +
        '<div>No hay registro de ventas para <strong>' + escHtml(suc) + '</strong> el <strong>' + fecha + '</strong></div>' +
        '<button class="mcor-btn-crear" style="margin-top:12px" onclick="window.mcorCrearRegistro()">' +
          '<i class="ti ti-plus"></i> Crear registro para este día' +
        '</button>' +
      '</td></tr>'
    );
  }

  // ── Crear registro vacío (cuando no existe) ────────────────────────────
  window.mcorCrearRegistro = async function () {
    var fecha = inputFecha?.value;
    var suc   = selSuc?.value;
    if (!fecha || !suc) return;

    setEstado('Creando registro…', 'loading');
    try {
      var resp = await fetch('/api/ventas/registros', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fecha, sucursal: suc, items: [], nota: 'Registro creado manualmente' }),
      });
      var data = await resp.json();
      if (!resp.ok) { setEstado('Error: ' + (data.error || '—'), 'error'); return; }

      registroActual = data;
      setEstado('Registro creado. Ahora puedes agregar ítems.', 'success');
      renderAccionsBar(registroActual);
      renderTabla(registroActual);
      setTimeout(function () {
        setEstado('');
        window.mcorMostrarFormAgregar();   // abrir el form de agregar automáticamente
      }, 1200);
    } catch (err) {
      setEstado('Error de conexión al crear.', 'error');
    }
  };

  // ── Barra de acciones ─────────────────────────────────────────────────
  function renderAccionsBar(reg) {
    if (!actionsBar) return;
    if (regBadge) {
      regBadge.textContent  = reg.esCorreccion ? 'Corregido' : 'Original';
      regBadge.className    = 'mcor-reg-badge ' + (reg.esCorreccion ? 'correg' : 'orig');
    }
    if (regInfo) {
      regInfo.textContent = reg.items.length + ' ítems · ID …' + String(reg._id).slice(-6);
    }
    actionsBar.classList.remove('hidden');
  }

  // ── Render tabla de ítems ─────────────────────────────────────────────
  function renderTabla(reg) {
    if (!tbody) return;
    if (!reg.items || !reg.items.length) {
      setTbody(
        '<tr><td colspan="7" class="mcor-fila-vacia">' +
          'Sin ítems. Usa <strong>Agregar ítem</strong> para empezar.' +
        '</td></tr>'
      );
      setFooterTotal(0);
      return;
    }

    var total = 0;
    var rows  = reg.items.map(function (item) {
      total += item.subtotal || 0;
      return buildRow(item);
    });
    setTbody(rows.join(''));
    setFooterTotal(total);

    // Bind eventos a los inputs/botones recién creados
    reg.items.forEach(function (item) {
      bindRowEvents(item._id);
    });
  }

  function buildRow(item) {
    var itemId = item._id;
    return (
      '<tr id="mcor-row-' + itemId + '" data-item-id="' + itemId + '">' +
        '<td style="font-weight:500">' + escHtml(item.nombre) + '</td>' +
        '<td style="color:var(--texto-suave);font-size:.78rem">' + escHtml(item.categoria) + '</td>' +
        '<td class="col-num">' +
          '<input class="mcor-inp mcor-cant" type="number" ' +
            'value="' + item.unidades + '" min="0" step="1" ' +
            'data-orig="' + item.unidades + '">' +
        '</td>' +
        '<td class="col-num">' +
          '<input class="mcor-inp mcor-precio" type="number" ' +
            'value="' + item.precioUnitario + '" min="0" step="0.01" ' +
            'data-orig="' + item.precioUnitario + '">' +
        '</td>' +
        '<td class="col-num mcor-subtotal-cell">' + fmtMXN(item.subtotal) + '</td>' +
        '<td style="text-align:center">' +
          '<button class="mcor-btn-row" data-action="guardar" disabled>' +
            '<i class="ti ti-device-floppy"></i> Guardar' +
          '</button>' +
        '</td>' +
        '<td style="text-align:center">' +
          '<button class="mcor-btn-del" data-action="eliminar" title="Eliminar ítem">' +
            '<i class="ti ti-trash"></i>' +
          '</button>' +
        '</td>' +
      '</tr>'
    );
  }

  function bindRowEvents(itemId) {
    var row      = document.getElementById('mcor-row-' + itemId);
    if (!row) return;
    var inpCant   = row.querySelector('.mcor-cant');
    var inpPrecio = row.querySelector('.mcor-precio');
    var subtCell  = row.querySelector('.mcor-subtotal-cell');
    var btnGuard  = row.querySelector('[data-action="guardar"]');
    var btnDel    = row.querySelector('[data-action="eliminar"]');

    function onChange() {
      var c   = parseFloat(inpCant.value)   || 0;
      var p   = parseFloat(inpPrecio.value) || 0;
      var sub = Math.round(c * p * 100) / 100;
      subtCell.textContent = fmtMXN(sub);
      var cambiado = c !== parseFloat(inpCant.dataset.orig) || p !== parseFloat(inpPrecio.dataset.orig);
      inpCant.classList.toggle('modificado',   c !== parseFloat(inpCant.dataset.orig));
      inpPrecio.classList.toggle('modificado', p !== parseFloat(inpPrecio.dataset.orig));
      subtCell.classList.toggle('modificado',  cambiado);
      btnGuard.disabled = !cambiado;
    }

    inpCant.addEventListener('input',   onChange);
    inpPrecio.addEventListener('input', onChange);

    btnGuard.addEventListener('click', function () {
      guardarItem(itemId, inpCant, inpPrecio, btnGuard, subtCell);
    });

    btnDel.addEventListener('click', function () {
      eliminarItem(itemId, btnDel);
    });
  }

  // ── Guardar edición de un ítem (PATCH editar) ─────────────────────────
  async function guardarItem(itemId, inpCant, inpPrecio, btn, subtCell) {
    var unidades       = parseFloat(inpCant.value)   || 0;
    var precioUnitario = parseFloat(inpPrecio.value) || 0;
    if (unidades < 0 || precioUnitario < 0) {
      setEstado('Los valores no pueden ser negativos.', 'error'); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader-2"></i>';
    setEstado('Guardando…', 'loading');

    try {
      var resp = await fetch('/api/ventas/registros/' + registroActual._id + '/items', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accion: 'editar', itemId, item: { unidades, precioUnitario } }),
      });
      var data = await resp.json();
      if (!resp.ok) {
        setEstado('Error: ' + (data.error || '—'), 'error');
        btn.disabled  = false;
        btn.innerHTML = '<i class="ti ti-device-floppy"></i> Guardar';
        return;
      }

      registroActual = data;

      // Actualizar originales en DOM
      inpCant.dataset.orig   = unidades;
      inpPrecio.dataset.orig = precioUnitario;
      inpCant.classList.remove('modificado');
      inpPrecio.classList.remove('modificado');
      subtCell.classList.remove('modificado');

      setFooterTotal(data.totalGeneral);
      renderHistorial(data.historial || []);
      renderAccionsBar(data);

      btn.innerHTML = '<i class="ti ti-check"></i> OK';
      setEstado('Corrección guardada.', 'success');
      setTimeout(function () {
        btn.disabled  = false;
        btn.innerHTML = '<i class="ti ti-device-floppy"></i> Guardar';
        setEstado('');
      }, 2000);
    } catch (err) {
      setEstado('Error de conexión al guardar.', 'error');
      btn.disabled  = false;
      btn.innerHTML = '<i class="ti ti-device-floppy"></i> Guardar';
    }
  }

  // ── Eliminar ítem (PATCH eliminar) ────────────────────────────────────
  async function eliminarItem(itemId, btn) {
    if (!registroActual) return;
    if (!confirm('¿Eliminar este ítem del registro? Esta acción quedará en el historial.')) return;

    btn.disabled = true;
    setEstado('Eliminando…', 'loading');

    try {
      var resp = await fetch('/api/ventas/registros/' + registroActual._id + '/items', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accion: 'eliminar', itemId }),
      });
      var data = await resp.json();
      if (!resp.ok) {
        setEstado('Error: ' + (data.error || '—'), 'error');
        btn.disabled = false;
        return;
      }

      registroActual = data;
      renderTabla(data);
      renderHistorial(data.historial || []);
      renderAccionsBar(data);
      setEstado('Ítem eliminado.', 'success');
      setTimeout(function () { setEstado(''); }, 2000);
    } catch (err) {
      setEstado('Error de conexión al eliminar.', 'error');
      btn.disabled = false;
    }
  }

  // ── Formulario "Agregar ítem" ─────────────────────────────────────────
  window.mcorMostrarFormAgregar = function () {
    if (!addForm) return;
    addForm.classList.remove('hidden');
    if (addNombre)   { addNombre.value = ''; addNombre.focus(); }
    if (addUds)      addUds.value     = '1';
    if (addPrecio)   addPrecio.value  = '0';
    if (addSub)      addSub.textContent = fmtMXN(0);
  };

  window.mcorOcultarFormAgregar = function () {
    addForm?.classList.add('hidden');
  };

  window.mcorSubmitAgregar = async function () {
    var nombre   = addNombre?.value.trim();
    var cat      = addCat?.value || 'Otro';
    var unidades = parseFloat(addUds?.value)    || 0;
    var precio   = parseFloat(addPrecio?.value) || 0;

    if (!nombre) {
      setEstado('El nombre del producto es obligatorio.', 'error'); return;
    }
    if (unidades <= 0) {
      setEstado('Las unidades deben ser mayor a 0.', 'error'); return;
    }

    var nuevoItem = { nombre, categoria: cat, unidades, precioUnitario: precio };
    setEstado('Agregando ítem…', 'loading');

    try {
      var url, method, body;

      if (registroActual) {
        // Registro ya existe → PATCH agregar
        url    = '/api/ventas/registros/' + registroActual._id + '/items';
        method = 'PATCH';
        body   = JSON.stringify({ accion: 'agregar', item: nuevoItem });
      } else {
        // No existe registro → POST crear con este primer ítem
        var fecha = inputFecha?.value;
        var suc   = selSuc?.value;
        url    = '/api/ventas/registros';
        method = 'POST';
        body   = JSON.stringify({ fecha, sucursal: suc, items: [nuevoItem] });
      }

      var resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      var data = await resp.json();
      if (!resp.ok) {
        setEstado('Error: ' + (data.error || '—'), 'error'); return;
      }

      registroActual = data;
      window.mcorOcultarFormAgregar();
      renderTabla(data);
      renderHistorial(data.historial || []);
      renderAccionsBar(data);
      setEstado('Ítem agregado correctamente.', 'success');
      setTimeout(function () { setEstado(''); }, 2000);
    } catch (err) {
      setEstado('Error de conexión al agregar.', 'error');
    }
  };

  // ── Historial de correcciones ─────────────────────────────────────────
  function renderHistorial(hist) {
    if (!histWrap) return;
    if (!hist.length) { histWrap.classList.add('hidden'); return; }

    var items = hist.slice().reverse().map(function (h) {
      var fecha = h.fecha
        ? new Date(h.fecha).toLocaleString('es-MX',
            { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
        : '';
      return '<div class="mcor-hist-item">' +
        '<span class="mcor-hist-dot"></span>' +
        '<div>' +
          '<strong>' + escHtml(h.modificadoPor || 'Sistema') + '</strong>' +
          (fecha ? ' · <span style="color:var(--texto-suave)">' + fecha + '</span>' : '') +
          (h.nota ? ' — <em style="color:var(--texto-suave)">' + escHtml(h.nota) + '</em>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    histWrap.innerHTML =
      '<div class="mcor-hist-titulo"><i class="ti ti-history"></i> Historial de cambios (' + hist.length + ')</div>' +
      items;
    histWrap.classList.remove('hidden');
  }

})();
