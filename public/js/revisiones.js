// revisiones.js — lógica del cliente para el módulo Revisiones i24h

// ── Dark mode ──────────────────────────────────────────────────
(function () {
  const btn = document.getElementById('rev-dark-btn');
  const ico = document.getElementById('rev-dark-ico');

  function aplicar(oscuro) {
    document.body.classList.toggle('dark', oscuro);
    document.documentElement.classList.toggle('dark', oscuro);
    localStorage.setItem('dark', oscuro ? '1' : '0');
    if (ico) ico.className = oscuro ? 'ti ti-sun' : 'ti ti-moon';
  }

  aplicar(localStorage.getItem('dark') === '1');

  if (btn) btn.addEventListener('click', () => {
    aplicar(!document.body.classList.contains('dark'));
  });
})();

// ── Estado global ──────────────────────────────────────────────
let revNcajaActual    = null;
let revSucursalActual = window.REV_SUCURSAL || 'todas';
let revTabActual      = window.REV_TAB      || 'contadores';
let revDiaActual      = window.REV_DIA      || 'todos';

// ── Inicialización al cargar ───────────────────────────────────
(function initFiltros() {
  // Restaurar sucursal seleccionada
  const sel = document.getElementById('rev-suc-sel');
  if (sel && window.REV_SUCURSAL) sel.value = window.REV_SUCURSAL;

  // Restaurar turno en el panel de revisiones
  const filTurno = document.getElementById('fil-turno');
  if (filTurno && window.REV_TURNO) filTurno.value = window.REV_TURNO;

  // Restaurar turno en el panel de impresoras
  const filTurnoImp = document.getElementById('fil-turno-imp');
  if (filTurnoImp && window.REV_TURNO) filTurnoImp.value = window.REV_TURNO;

  // Restaurar turno en el panel de resumen
  const filTurnoRes = document.getElementById('fil-turno-res');
  if (filTurnoRes && window.REV_TURNO) filTurnoRes.value = window.REV_TURNO;

  // Restaurar periodo
  const periodoSel = document.getElementById('rev-periodo-sel');
  if (periodoSel && window.REV_PERIODO) {
    periodoSel.value = window.REV_PERIODO;
    const rango = document.getElementById('rev-rango-custom');
    if (rango) rango.classList.toggle('rev-rango--oculto', window.REV_PERIODO !== 'personalizado');
  }

  // Restaurar estado
  const filEstado = document.getElementById('fil-estado');
  if (filEstado && window.REV_ESTADO) filEstado.value = window.REV_ESTADO;

  // Activar el tab correcto
  if (window.REV_TAB && window.REV_TAB !== 'contadores') {
    revCambiarTab(window.REV_TAB);
  }
})();

// ── Cambiar entre tabs ─────────────────────────────────────────
function revCambiarTab(tab) {
  var tabEl   = document.getElementById('tab-' + tab);
  var panelEl = document.getElementById('panel-' + tab);
  // Si 'tab' viene de ?tab= en la URL puede no existir ninguno de los 3
  // tabs reales — sin esto, un enlace/URL manual con un valor inválido
  // rompía el script entero de la página (y con él, todos los botones).
  if (!tabEl || !panelEl) return;

  revTabActual = tab;
  document.querySelectorAll('.rev-tab').forEach(t => t.classList.remove('rev-tab--active'));
  document.querySelectorAll('.rev-panel').forEach(p => p.classList.add('rev-panel--oculto'));

  tabEl.classList.add('rev-tab--active');
  panelEl.classList.remove('rev-panel--oculto');
}

// ── Cambiar periodo (muestra/oculta rango personalizado) ──────
function revCambiarPeriodo() {
  const val   = document.getElementById('rev-periodo-sel')?.value;
  const rango = document.getElementById('rev-rango-custom');
  if (rango) rango.classList.toggle('rev-rango--oculto', val !== 'personalizado');
  if (val !== 'semana') revDiaActual = 'todos';
  if (val !== 'personalizado') revFiltrar();
}

// ── Cambiar día dentro de "Esta semana" ────────────────────────
function revCambiarDia(fecha) {
  revDiaActual = fecha;
  revFiltrar();
}

// ── Filtrar (recarga la página con parámetros) ─────────────────
function revFiltrar() {
  const sucursal  = document.getElementById('rev-suc-sel')?.value     || 'todas';
  const turnoElId = revTabActual === 'impresoras' ? 'fil-turno-imp'
                  : revTabActual === 'resumen'    ? 'fil-turno-res'
                  : 'fil-turno';
  const turno     = document.getElementById(turnoElId)?.value          || 'todos';
  const estado    = document.getElementById('fil-estado')?.value       || 'todos';
  const periodo   = document.getElementById('rev-periodo-sel')?.value  || 'mes_actual';
  const desde     = document.getElementById('rev-desde')?.value        || '';
  const hasta     = document.getElementById('rev-hasta')?.value        || '';
  const params    = new URLSearchParams({ sucursal, turno, estado, tab: revTabActual, periodo });
  if (periodo === 'personalizado' && desde && hasta) {
    params.set('desde', desde);
    params.set('hasta', hasta);
  }
  if (periodo === 'semana' && revDiaActual && revDiaActual !== 'todos') {
    params.set('dia', revDiaActual);
  }
  window.location.href = '/revisiones?' + params.toString();
}

// ── Ver detalle de revisión ────────────────────────────────────
async function revVerDetalle(ncaja, sucursal) {
  revNcajaActual    = ncaja;
  revSucursalActual = sucursal;

  document.getElementById('rev-modal-titulo').textContent = `Caja #${ncaja} · ${sucursal}`;
  document.getElementById('rev-modal-body').innerHTML = '<div class="rev-empty"><i class="ti ti-loader-2"></i><p>Cargando…</p></div>';
  document.getElementById('rev-modal-overlay').classList.remove('rev-modal--oculto');

  try {
    const resp = await fetch(`/revisiones/api/${ncaja}?sucursal=${encodeURIComponent(sucursal)}`);
    if (!resp.ok) throw new Error('No encontrado');
    const { revision, contadores } = await resp.json();
    document.getElementById('rev-modal-body').innerHTML = revRenderDetalle(revision, contadores);
  } catch (err) {
    document.getElementById('rev-modal-body').innerHTML =
      '<div class="rev-empty"><i class="ti ti-alert-triangle"></i><p>Error al cargar el detalle</p></div>';
  }
}

// ── Renderizar detalle dentro del modal ────────────────────────
function revRenderDetalle(r, contadores) {
  const fmt = n => (n ?? 0).toLocaleString('es-MX');
  const difClass = d => d > 0 ? 'rev-dif-ok' : (d < -20 ? 'rev-dif-peligro' : (d < 0 ? 'rev-dif-alerta' : ''));

  const filasCmp = (r.comparaciones || []).map(c => `
    <tr>
      <td>${c.etiqueta || c.concepto}</td>
      <td style="text-align:right">${fmt(c.contador)}</td>
      <td style="text-align:right">${fmt(c.cobrado)}</td>
      <td style="text-align:right" class="${difClass(c.diferencia)}">${c.diferencia > 0 ? '+' : ''}${fmt(c.diferencia)}</td>
      <td>${c.causa || (c.cobrable ? '<span class="rev-pill rev-pill--peligro">Sin causa</span>' : '—')}</td>
    </tr>
  `).join('');

  const histItems = (r.historial || []).slice().reverse().map(h => {
    const f = h.fecha ? new Date(h.fecha).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
    return `<div class="rev-hist-item">
      <span class="rev-hist-fecha">${f}</span>
      <div><span class="rev-hist-actor">${h.actor || '—'}</span> <span class="rev-hist-det">${h.detalle || ''}</span></div>
    </div>`;
  }).join('');

  const contHtml = contadores.length ? contadores.map(ci => `
    <div class="dash-imp-titulo">${ci.nombre} · ${ci.ip}</div>
    <div class="dash-imp-fila"><span class="dash-imp-lbl">Negro (delta)</span><span class="dash-imp-val">${fmt(ci.copiarNegro?.delta)}</span></div>
    <div class="dash-imp-fila"><span class="dash-imp-lbl">Color (delta)</span><span class="dash-imp-val">${fmt(ci.copiarColor?.delta)}</span></div>
    <div class="dash-imp-fila"><span class="dash-imp-lbl">Escáner (delta)</span><span class="dash-imp-val">${fmt(ci.escanerTotal?.delta)}</span></div>
  `).join('') : '<p style="color:var(--r-tex-muted);font-size:13px">Sin lecturas de impresora</p>';

  return `
    <p style="margin-bottom:12px"><b>Operador:</b> ${r.operador || '—'} &nbsp;·&nbsp; <b>Turno:</b> ${r.turno || '—'}</p>

    <h4 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--r-tex-muted);margin-bottom:8px">Contador vs Cobrado</h4>
    ${filasCmp ? `
    <table class="rev-comp-table">
      <thead><tr><th>Concepto</th><th style="text-align:right">Contador</th><th style="text-align:right">Cobrado</th><th style="text-align:right">Diferencia</th><th>Causa</th></tr></thead>
      <tbody>${filasCmp}</tbody>
    </table>` : '<p style="color:var(--r-tex-muted);font-size:13px">Sin comparaciones</p>'}

    <h4 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--r-tex-muted);margin:16px 0 8px">Contadores de impresora</h4>
    ${contHtml}

    ${histItems ? `<h4 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--r-tex-muted);margin:16px 0 8px">Historial</h4>${histItems}` : ''}
  `;
}

// ── Cerrar modal ───────────────────────────────────────────────
function revCerrarModal() {
  document.getElementById('rev-modal-overlay').classList.add('rev-modal--oculto');
  revNcajaActual = null;
}

// ── Aprobar revisión ───────────────────────────────────────────
async function revAprobar() {
  if (!revNcajaActual) return;
  try {
    const resp = await fetch(`/revisiones/api/${revNcajaActual}/aprobar`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sucursal: revSucursalActual }),
    });
    const datos = await resp.json();
    if (!resp.ok) { revToast(datos.error || 'Error', true); return; }
    revToast('Revisión aprobada');
    revCerrarModal();
    setTimeout(() => window.location.reload(), 1200);
  } catch {
    revToast('No se pudo conectar al servidor', true);
  }
}

// ── Cargar más revisiones ──────────────────────────────────────
function revCargarMas(paginaActual) {
  const params = new URLSearchParams(window.location.search);
  params.set('pagina', paginaActual + 1);
  window.location.href = '/revisiones?' + params.toString();
}

// ── CONTEO DE INVENTARIO ───────────────────────────────────────

let conteoProdsCargados = [];
let conteoModoVer       = false;
let conteoSyncTimer     = null;
let conteoSyncSegundos  = 0;
let conteoSyncTick      = null;

function conteoIniciarSync(sucursal) {
  conteoDetenerSync();
  conteoSyncSegundos = 0;
  _conteoActualizarBadge();

  conteoSyncTimer = setInterval(async () => {
    try {
      const resp = await fetch('/revisiones/api/conteo/productos?sucursal=' + encodeURIComponent(sucursal));
      const data = await resp.json();
      if (!resp.ok || !data.productos) return;

      const tbody = document.getElementById('conteo-tbody');
      if (!tbody) return;

      data.productos.forEach(p => {
        const fila = tbody.querySelector(`tr[data-codigo="${p.codigo}"]`);
        if (!fila) return;
        const espCell = fila.querySelector('.conteo-esp-val');
        const inp     = fila.querySelector('.conteo-num-in');
        if (!espCell || !inp) return;
        const stockNuevo = p.stock;
        espCell.textContent = stockNuevo;
        inp.dataset.esp = stockNuevo;
        conteoActFila(inp);
      });

      conteoSyncSegundos = 0;
    } catch (_) {}
  }, 60000);

  // Contador de segundos para el badge
  conteoSyncTick = setInterval(() => {
    conteoSyncSegundos++;
    _conteoActualizarBadge();
  }, 1000);
}

function conteoDetenerSync() {
  if (conteoSyncTimer) { clearInterval(conteoSyncTimer); conteoSyncTimer = null; }
  if (conteoSyncTick)  { clearInterval(conteoSyncTick);  conteoSyncTick  = null; }
}

function _conteoActualizarBadge() {
  const badge = document.getElementById('conteo-sync-badge');
  if (!badge) return;
  badge.textContent = conteoSyncSegundos === 0
    ? 'Stock actualizado ahora'
    : `Stock actualizado hace ${conteoSyncSegundos}s`;
}

function revNuevoConteo() {
  conteoModoVer = false;

  // Reset modal
  document.getElementById('conteo-titulo').innerHTML = '<i class="ti ti-package"></i> Nuevo conteo de inventario';
  document.getElementById('conteo-form').style.display = '';
  document.getElementById('conteo-tabla-wrap').style.display = 'none';
  document.getElementById('conteo-resumen').style.display = 'none';
  document.getElementById('conteo-btn-guardar').style.display = 'none';
  document.getElementById('conteo-tbody').innerHTML = '';
  document.getElementById('conteo-resumen').innerHTML = '';

  // Pre-fill from page state
  const suc = window.REV_SUCURSAL;
  const sel = document.getElementById('conteo-sucursal');
  if (sel && suc && suc !== 'todas') sel.value = suc;

  const inp = document.getElementById('conteo-responsable');
  if (inp) inp.value = window.REV_USUARIO || '';

  const btn = document.getElementById('conteo-btn-cargar');
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-refresh"></i> Cargar productos';

  document.getElementById('conteo-overlay').classList.remove('rev-modal--oculto');
}

async function conteoCargar() {
  const sucursal    = document.getElementById('conteo-sucursal').value;
  const responsable = document.getElementById('conteo-responsable').value.trim();

  if (!sucursal)    { revToast('Selecciona una sucursal', true); return; }
  if (!responsable) { revToast('Escribe el nombre del responsable', true); return; }

  const btn = document.getElementById('conteo-btn-cargar');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Cargando…';

  try {
    const resp = await fetch('/revisiones/api/conteo/productos?sucursal=' + encodeURIComponent(sucursal));
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    if (!data.productos.length) throw new Error('Esta sucursal no tiene productos sincronizados aún');

    conteoProdsCargados = data.productos;
    conteoRenderTablaEditable(data.productos);
    conteoIniciarSync(sucursal);

    document.getElementById('conteo-tabla-wrap').style.display = '';
    document.getElementById('conteo-resumen').style.display = '';
    document.getElementById('conteo-btn-guardar').style.display = 'inline-flex';
    conteoActualizarResumen();
  } catch (err) {
    revToast(err.message || 'Error al cargar productos', true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-refresh"></i> Recargar';
  }
}

function conteoRenderTablaEditable(prods) {
  document.getElementById('conteo-tbody').innerHTML = prods.map((p, i) => `
    <tr data-codigo="${p.codigo}">
      <td class="conteo-td-nom">${p.nombre}</td>
      <td class="conteo-td-num conteo-esp-val">${p.stock}</td>
      <td class="conteo-td-inp">
        <input type="number" class="conteo-num-in" min="0"
          value="${p.stock}" data-idx="${i}" data-esp="${p.stock}"
          oninput="conteoActFila(this)" />
      </td>
      <td class="conteo-td-dif" id="cdif-${i}">0</td>
    </tr>
  `).join('');
}

function conteoActFila(inp) {
  const idx = Number(inp.dataset.idx);
  const esp = Number(inp.dataset.esp);
  const fis = Number(inp.value) || 0;
  const dif = fis - esp;
  const td  = document.getElementById('cdif-' + idx);
  td.textContent = dif > 0 ? '+' + dif : String(dif);
  td.className   = 'conteo-td-dif ' + (dif === 0 ? '' : dif > 0 ? 'rev-dif-ok' : 'rev-dif-peligro');
  conteoActualizarResumen();
}

function conteoActualizarResumen() {
  const inputs = document.querySelectorAll('.conteo-num-in');
  let conDif = 0;
  inputs.forEach(i => { if ((Number(i.value) || 0) !== Number(i.dataset.esp)) conDif++; });
  const el = document.getElementById('conteo-resumen');
  el.innerHTML =
    `<span><b>${inputs.length}</b> productos cargados</span>` +
    `<span class="${conDif > 0 ? 'rev-dif-peligro' : 'rev-dif-ok'}"><b>${conDif}</b> con diferencia</span>`;
}

async function conteoGuardar() {
  const sucursal    = document.getElementById('conteo-sucursal').value;
  const responsable = document.getElementById('conteo-responsable').value.trim();
  if (!sucursal || !responsable) { revToast('Completa los campos', true); return; }

  const inputs = document.querySelectorAll('.conteo-num-in');
  const lineas = Array.from(inputs).map((inp, i) => ({
    codigo:   conteoProdsCargados[i].codigo,
    nombre:   conteoProdsCargados[i].nombre,
    fisico:   Number(inp.value) || 0,
    esperado: Number(inp.dataset.esp),
  }));

  const btn = document.getElementById('conteo-btn-guardar');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Guardando…';

  try {
    const resp = await fetch('/revisiones/api/conteo', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sucursal, responsable, lineas }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    revToast('Conteo guardado correctamente');
    conteoCerrar();
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    revToast(err.message || 'Error al guardar', true);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-device-floppy"></i> Guardar conteo';
  }
}

async function conteoVerDetalle(id) {
  conteoModoVer = true;

  // Configurar modal en modo ver
  document.getElementById('conteo-titulo').innerHTML = '<i class="ti ti-package"></i> Detalle de conteo';
  document.getElementById('conteo-form').style.display = 'none';
  document.getElementById('conteo-tabla-wrap').style.display = '';
  document.getElementById('conteo-resumen').style.display = '';
  document.getElementById('conteo-btn-guardar').style.display = 'none';
  document.getElementById('conteo-resumen').innerHTML = 'Cargando…';
  document.getElementById('conteo-tbody').innerHTML =
    '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--r-tex-muted)"><i class="ti ti-loader-2"></i> Cargando…</td></tr>';

  document.getElementById('conteo-overlay').classList.remove('rev-modal--oculto');

  try {
    const resp = await fetch('/revisiones/api/conteo/' + id);
    const { conteo } = await resp.json();

    const fmt = d => d
      ? new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';

    document.getElementById('conteo-resumen').innerHTML =
      `<span><b>${conteo.sucursal}</b></span>` +
      `<span>${fmt(conteo.fecha)}</span>` +
      `<span>Responsable: <b>${conteo.responsable}</b></span>` +
      `<span class="${conteo.productosConDif > 0 ? 'rev-dif-peligro' : 'rev-dif-ok'}">` +
        `<b>${conteo.productosConDif}</b> con diferencia</span>`;

    document.getElementById('conteo-tbody').innerHTML = (conteo.lineas || []).map(l => {
      const dif = l.diferencia;
      const cls = dif === 0 ? '' : dif > 0 ? 'rev-dif-ok' : 'rev-dif-peligro';
      return `<tr>
        <td class="conteo-td-nom">${l.nombre}</td>
        <td class="conteo-td-num">${l.esperado}</td>
        <td class="conteo-td-num">${l.fisico}</td>
        <td class="conteo-td-dif ${cls}">${dif > 0 ? '+' : ''}${dif}</td>
      </tr>`;
    }).join('');

    // Historial
    if (conteo.historial?.length) {
      const hist = conteo.historial.slice().reverse().map(h => {
        const fh = h.fecha ? new Date(h.fecha).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
        return `<div class="rev-hist-item">
          <span class="rev-hist-fecha">${fh}</span>
          <div><span class="rev-hist-actor">${h.actor || '—'}</span>
          <span class="rev-hist-det"> ${h.detalle || ''}</span></div>
        </div>`;
      }).join('');
      document.getElementById('conteo-tbody').innerHTML +=
        `<tr><td colspan="4" style="padding-top:16px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--r-tex-muted);margin-bottom:8px">Historial</div>
          ${hist}
        </td></tr>`;
    }
  } catch {
    revToast('Error al cargar el detalle', true);
  }
}

function conteoCerrar() {
  conteoDetenerSync();
  document.getElementById('conteo-overlay').classList.add('rev-modal--oculto');
  document.getElementById('conteo-form').style.display = '';
  conteoModoVer = false;
}

// ── Toast ──────────────────────────────────────────────────────
function revToast(msg, esError = false) {
  const el = document.getElementById('rev-toast');
  const ic = document.getElementById('rev-toast-ico');
  const ms = document.getElementById('rev-toast-msg');
  if (!el) return;

  el.classList.remove('rev-toast--visible', 'rev-toast--error');
  if (esError) el.classList.add('rev-toast--error');
  if (ic) ic.className = esError ? 'ti ti-alert-triangle' : 'ti ti-check';
  if (ms) ms.textContent = msg;

  el.classList.add('rev-toast--visible');
  setTimeout(() => el.classList.remove('rev-toast--visible'), 3500);
}
