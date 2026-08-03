/* ============================================================
   HORARIOS — cliente vanilla JS
   ============================================================ */

'use strict';

// ── Estado global ─────────────────────────────────────────────

let horSemana   = window.HOR_SEMANA   || isoWeekStr(new Date());
let horSucursal = window.HOR_SUCURSAL || 'todas';
let horData     = window.HOR_DATA     || { horarios: [], empleados: [], sucursales: [] };

// Estado del editor
let gridState = {
  horarioId: null,
  sucursal: null,
  semana: null,
  turnos: { T1: vaciarTurnos(), T2: vaciarTurnos(), T3: vaciarTurnos() },
};
let indicacionCtx = null; // { turno, dia, empleadoId }
let editorAbierto = false;

// ── Utilidades de semana ─────────────────────────────────────

// Escapa HTML antes de insertar valores de Mongo (nombre de empleado, etc.)
// en innerHTML — sin esto, el nombre de un empleado con <script> se
// ejecutaría en la pantalla de cualquiera que abra el roster de Horarios.
function escHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function isoWeekStr(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getFullYear() + '-' + String(weekNo).padStart(2, '0');
}

// Retorna el viernes (inicio de semana) para un YYYY-WW
function getViernesDeISO(weekStr) {
  const parts = weekStr.split('-');
  const year  = parseInt(parts[0], 10);
  const week  = parseInt(parts[1], 10);
  const jan4  = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7; // 0=Lun … 6=Dom
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  // Nuestro "viernes" es el lunes anterior (Mon - 3 días)
  const viernes = new Date(monday);
  viernes.setDate(monday.getDate() - 3);
  return viernes;
}

function formatFechaCorta(d) {
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function addWeeks(weekStr, delta) {
  const viernes = getViernesDeISO(weekStr);
  viernes.setDate(viernes.getDate() + delta * 7);
  return isoWeekStr(viernes);
}

function semanaLabel(weekStr) {
  const [yr, wk] = weekStr.split('-');
  const vie = getViernesDeISO(weekStr);
  const jue = new Date(vie);
  jue.setDate(vie.getDate() + 6);
  return 'Sem ' + wk + ' · ' + formatFechaCorta(vie) + ' – ' + formatFechaCorta(jue);
}

// ── Utilidades de cuadrícula ─────────────────────────────────

function vaciarTurnos() {
  return Array.from({ length: 7 }, function(_, i) {
    return { dia: i, empleados: [], estado: 'normal', indicacion: '' };
  });
}

// Serializa gridState.turnos al formato que espera la BD.
// 'doble' es estado visual de la UI — no está en el enum del modelo,
// así que se normaliza a 'normal' antes de enviar.
const ESTADOS_VALIDOS = new Set(['normal', 'cambio', 'conflicto', 'vacio']);
function serializarTurnos() {
  const resultado = { T1: [], T2: [], T3: [] };
  ['T1', 'T2', 'T3'].forEach(function(t) {
    gridState.turnos[t].forEach(function(celda) {
      if (celda.empleados.length > 0 || celda.indicacion) {
        resultado[t].push({
          dia:       celda.dia,
          empleados: celda.empleados.map(function(e) { return e._id; }),
          estado:    ESTADOS_VALIDOS.has(celda.estado) ? celda.estado : 'normal',
          indicacion: celda.indicacion,
        });
      }
    });
  });
  return resultado;
}

function avatarColor(nombre) {
  var colores = ['#c0392b','#2980b9','#27ae60','#8e44ad','#e67e22','#16a085','#d35400','#2c3e50'];
  var hash = 0;
  for (var i = 0; i < nombre.length; i++) hash = nombre.charCodeAt(i) + ((hash << 5) - hash);
  return colores[Math.abs(hash) % colores.length];
}

function iniciales(nombre) {
  return nombre.split(' ').slice(0, 2).map(function(p) { return p[0]; }).join('').toUpperCase();
}

// ── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  horActualizarWeekUI();
  horRenderView(horData.horarios, horData.empleados);
  horInitNavListeners();
  horInitIndicacionTipos();
  horInitTabs();

  // Cerrar modal de indicación al hacer click fuera
  document.addEventListener('click', function(e) {
    var modal = document.getElementById('indicacion-modal');
    if (modal.style.display !== 'none' && !modal.contains(e.target) && !e.target.closest('.drop-chip-note')) {
      horCloseIndicacion();
    }
  });
});

// ── Actualizar UI de semana ───────────────────────────────────

function horActualizarWeekUI() {
  var pill  = document.getElementById('hor-week-pill');
  var label = document.getElementById('hor-week-label');
  var parts = horSemana.split('-');
  if (pill)  pill.textContent  = 'Semana ' + parts[1];
  if (label) label.textContent = semanaLabel(horSemana);

  var sel = document.getElementById('hor-suc-filter');
  if (sel) sel.value = horSucursal;
}

// ── Navegación de semanas ─────────────────────────────────────

function horInitNavListeners() {
  var prev = document.getElementById('hor-prev-week');
  var next = document.getElementById('hor-next-week');
  if (prev) prev.addEventListener('click', function() { horNavigateWeek(-1); });
  if (next) next.addEventListener('click', function() { horNavigateWeek( 1); });
}

function horNavigateWeek(dir) {
  horSemana = addWeeks(horSemana, dir);
  horActualizarWeekUI();
  horCargarSemana(horSemana, horSucursal);
  if (horTabActiva === 'has') hasCargarSemana(horSemana, horSucursal);
}

async function horCargarSemana(semana, sucursal) {
  try {
    var url = '/horarios/api/semana/' + encodeURIComponent(semana) + '/' + encodeURIComponent(sucursal);
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('Error ' + resp.status);
    var data = await resp.json();
    horData.horarios  = data.horarios;
    horData.semana    = semana;
    horData.sucursal  = sucursal;
    horRenderView(data.horarios, horData.empleados);
    if (editorAbierto) horCloseEditor();
  } catch (err) {
    horToast('Error al cargar la semana', 'error');
    console.error(err);
  }
}

// ── Filtro por sucursal ───────────────────────────────────────

function horFilterSucursal(valor) {
  horSucursal = valor;
  var bloques = document.querySelectorAll('.suc-block');
  bloques.forEach(function(b) {
    if (valor === 'todas' || b.dataset.sucursal === valor) {
      b.style.display = '';
    } else {
      b.style.display = 'none';
    }
  });
  if (horTabActiva === 'has') hasCargarSemana(horSemana, horSucursal);
}
window.horFilterSucursal = horFilterSucursal;

// ── Tabs: Vista semanal / Horas trabajadas ────────────────────

let horTabActiva = 'semanal';

function horInitTabs() {
  horSwitchTab('semanal');
}

function horSwitchTab(tab) {
  horTabActiva = tab;

  var btnSemanal = document.getElementById('hor-tab-semanal');
  var btnHas     = document.getElementById('hor-tab-has');
  var mainSemanal = document.getElementById('hor-main-semanal');
  var mainHas      = document.getElementById('has-view-wrap');

  if (tab === 'semanal') {
    if (btnSemanal) btnSemanal.classList.add('hor-tab--active');
    if (btnHas)     btnHas.classList.remove('hor-tab--active');
    if (mainSemanal) mainSemanal.style.display = '';
    if (mainHas)      mainHas.style.display = 'none';
  } else {
    if (btnSemanal) btnSemanal.classList.remove('hor-tab--active');
    if (btnHas)     btnHas.classList.add('hor-tab--active');
    if (mainSemanal) mainSemanal.style.display = 'none';
    if (mainHas)      mainHas.style.display = '';
    hasCargarSemana(horSemana, horSucursal);
  }
}
window.horSwitchTab = horSwitchTab;

// ── Horas trabajadas — carga y render de la tabla ─────────────

async function hasCargarSemana(semana, sucursal) {
  var tbody = document.getElementById('has-table-body');
  var vacio = document.getElementById('has-empty');
  if (!tbody) return;

  try {
    var url = '/asistencia/api/horas-trabajadas?semana=' + encodeURIComponent(semana) +
      '&sucursal=' + encodeURIComponent(sucursal);
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('Error ' + resp.status);
    var data = await resp.json();
    hasRenderTabla(data.filas || []);
  } catch (err) {
    tbody.innerHTML = '';
    if (vacio) { vacio.style.display = ''; vacio.textContent = 'Error al cargar horas trabajadas'; }
    console.error(err);
  }
}

function hasRenderTabla(filas) {
  var tbody = document.getElementById('has-table-body');
  var vacio = document.getElementById('has-empty');
  if (!tbody) return;

  if (!filas.length) {
    tbody.innerHTML = '';
    if (vacio) { vacio.style.display = ''; vacio.textContent = 'Sin marcaciones esta semana'; }
    return;
  }
  if (vacio) vacio.style.display = 'none';

  tbody.innerHTML = filas.map(function (f) {
    var diffTexto = f.diferencia == null ? '—' :
      (f.diferencia >= 0 ? '+' : '') + f.diferencia + 'h';
    var diffClase = f.diferencia == null ? '' : (f.diferencia < 0 ? 'has-diff-neg' : 'has-diff-pos');
    return '<tr>' +
      '<td>' + f.nombre + '</td>' +
      '<td>' + f.sucursal + '</td>' +
      '<td>' + f.horasTrabajadas + 'h</td>' +
      '<td>' + f.horasComida + 'h</td>' +
      '<td>' + (f.horasEsperadas == null ? '—' : f.horasEsperadas + 'h') + '</td>' +
      '<td class="' + diffClase + '">' + diffTexto + '</td>' +
      '</tr>';
  }).join('');
}

// ── Render sección B: vista semanal ──────────────────────────

var DIAS_NOMBRE = ['Vie', 'Sáb', 'Dom', 'Lun', 'Mar', 'Mié', 'Jue'];
var SUCURSALES  = [
  'Simón Bolívar',
  'Insurgentes',
  'Antígona',
  'Lincoln Oxxo',
  'Lincoln 2',
  'Ruiz Cortines',
  'Rodas',
  'Cuauhtémoc',
  'Ordóñez',
];
var PUNTO_COLOR = {
  'Simón Bolívar':  '#c0392b',
  'Insurgentes':    '#27ae60',
  'Antígona':       '#8e44ad',
  'Lincoln Oxxo':   '#e67e22',
  'Lincoln 2':      '#2980b9',
  'Ruiz Cortines':  '#16a085',
  'Rodas':          '#d35400',
  'Cuauhtémoc':     '#2c3e50',
  'Ordóñez':        '#1abc9c',
};
var TURNOS_KEYS = ['T1', 'T2', 'T3'];
var rosterActual = []; // roster completo (ya filtrado por sucursal), para el buscador de nombre

function horRenderView(horarios, empleados) {
  var wrap = document.getElementById('hor-view-wrap');
  if (!wrap) return;

  // Índice de horarios por sucursal
  var idx = {};
  horarios.forEach(function(h) { idx[h.sucursal] = h; });

  // Cuenta empleados por sucursal
  var empPorSuc = {};
  SUCURSALES.forEach(function(s) { empPorSuc[s] = 0; });
  empleados.forEach(function(e) {
    (e.sucursales || []).forEach(function(s) {
      if (empPorSuc[s] !== undefined) empPorSuc[s]++;
    });
  });

  wrap.innerHTML = '';
  SUCURSALES.forEach(function(suc) {
    wrap.appendChild(horCrearBloqueVista(suc, idx[suc] || null, empPorSuc[suc] || 0));
  });

  // Aplicar filtro actual si hay uno seleccionado
  if (horSucursal !== 'todas') horFilterSucursal(horSucursal);
}

function horCrearBloqueVista(sucursal, horario, numEmp) {
  var estado   = horario ? horario.estado : 'sin horario';
  var badgeHTML = estado === 'publicado'
    ? '<span class="badge-ok">Confirmado</span>'
    : estado === 'borrador'
      ? '<span class="badge-pend">Borrador</span>'
      : '<span class="badge-pend">Sin horario</span>';

  var bloque = document.createElement('div');
  bloque.className = 'suc-block slide-up';
  bloque.dataset.sucursal = sucursal;

  bloque.innerHTML =
    '<div class="suc-header">' +
      '<div class="suc-header-left">' +
        '<span class="suc-dot" style="background:' + PUNTO_COLOR[sucursal] + '"></span>' +
        '<span class="suc-name">' + sucursal + '</span>' +
        '<span class="suc-meta">' + numEmp + ' empleados</span>' +
        badgeHTML +
      '</div>' +
      '<button class="hor-btn hor-btn-outline" onclick="horOpenEditor(\'' + sucursal.replace(/'/g, "\\'") + '\')">' +
        '<i class="ti ti-edit"></i> Editar' +
      '</button>' +
    '</div>' +
    horTablaVista(horario);

  return bloque;
}

function horTablaVista(horario) {
  if (!horario) {
    return '<div class="hor-empty"><i class="ti ti-calendar-off"></i>' +
           '<p>Sin horario esta semana</p></div>';
  }

  var html = '<div class="suc-table-wrap"><table class="sched-table"><thead><tr>' +
    '<th style="width:52px">Turno</th>' + DIAS_NOMBRE.map(function(d) { return '<th>' + d + '</th>'; }).join('') +
    '</tr></thead><tbody>';

  TURNOS_KEYS.forEach(function(t) {
    html += '<tr><td><div class="turno-label turno-label--' + t.toLowerCase() + '">' + t + '</div></td>';
    var celdas = horario.turnos ? horario.turnos[t] : [];
    // Normaliza a 7 posiciones
    var grid = new Array(7).fill(null).map(function(_, i) {
      return { dia: i, empleados: [], estado: 'vacio', indicacion: '' };
    });
    (celdas || []).forEach(function(c) {
      if (c.dia >= 0 && c.dia <= 6) grid[c.dia] = c;
    });

    grid.forEach(function(celda) {
      html += '<td>';
      if (celda.empleados && celda.empleados.length > 0) {
        html += '<div class="chip-list">';
        celda.empleados.forEach(function(emp) {
          var nombre = typeof emp === 'object' ? emp.nombre : String(emp);
          html += '<div class="chip chip--' + (celda.estado || 'normal') + '">' +
                  '<span class="chip-text">' + nombre + '</span></div>';
        });
        if (celda.indicacion) {
          html += '<div class="chip-indicacion">' + celda.indicacion + '</div>';
        }
        html += '</div>';
      }
      html += '</td>';
    });
    html += '</tr>';
  });

  return html + '</tbody></table></div>';
}

// ── Editor (Sección C) ────────────────────────────────────────

function horOpenEditor(sucursal) {
  editorAbierto = true;
  var view   = document.getElementById('hor-view-wrap');
  var editor = document.getElementById('hor-editor');
  if (view)   view.style.display   = 'none';
  if (editor) editor.style.display = '';

  var horario = horData.horarios.find(function(h) { return h.sucursal === sucursal; }) || null;

  // Inicializar gridState
  gridState.sucursal  = sucursal;
  gridState.semana    = horSemana;
  gridState.horarioId = horario ? String(horario._id) : null;
  gridState.turnos    = { T1: vaciarTurnos(), T2: vaciarTurnos(), T3: vaciarTurnos() };

  if (horario && horario.turnos) {
    TURNOS_KEYS.forEach(function(t) {
      var celdas = horario.turnos[t] || [];
      celdas.forEach(function(c) {
        if (c.dia >= 0 && c.dia <= 6) {
          gridState.turnos[t][c.dia] = {
            dia:       c.dia,
            empleados: (c.empleados || []).map(function(e) {
              return typeof e === 'object' ? e : { _id: String(e), nombre: '—', cargo: '' };
            }),
            estado:    c.estado || 'normal',
            indicacion: c.indicacion || '',
          };
        }
      });
    });
  }

  // Label del editor
  var label = document.getElementById('hor-editor-suc-label');
  if (label) label.textContent = sucursal;
  var title = document.getElementById('hor-grid-title');
  if (title) title.textContent = sucursal + ' — ' + semanaLabel(horSemana);

  // Cargar roster filtrado por sucursal
  horCargarRoster(sucursal);
  // Renderizar cuadrícula
  horRenderGrid();
}
window.horOpenEditor = horOpenEditor;

function horCloseEditor() {
  editorAbierto = false;
  var view   = document.getElementById('hor-view-wrap');
  var editor = document.getElementById('hor-editor');
  if (view)   view.style.display   = '';
  if (editor) editor.style.display = 'none';
  horCloseIndicacion();
}
window.horCloseEditor = horCloseEditor;

// ── Roster del equipo ─────────────────────────────────────────

async function horCargarRoster(sucursal) {
  try {
    var resp = await fetch('/horarios/api/empleados');
    var todos = await resp.json();
    var filtrados = todos.filter(function(e) {
      return (e.sucursales || []).includes(sucursal);
    });
    rosterActual = filtrados;
    var buscador = document.getElementById('hor-team-buscar');
    if (buscador) buscador.value = '';
    horRenderRoster(filtrados);
  } catch (err) {
    console.error('Error al cargar roster:', err);
  }
}

// Quita acentos para que "cesar" encuentre "César"
function horNormalizarTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function horFiltrarRoster(texto) {
  var q = horNormalizarTexto(texto).trim();
  if (!q) { horRenderRoster(rosterActual); return; }
  var filtrados = rosterActual.filter(function(e) {
    return horNormalizarTexto(e.nombre).indexOf(q) !== -1;
  });
  horRenderRoster(filtrados);
}

(function () {
  var buscador = document.getElementById('hor-team-buscar');
  if (buscador) buscador.addEventListener('input', function () {
    horFiltrarRoster(buscador.value);
  });
})();

function horRenderRoster(empleados) {
  var list = document.getElementById('hor-team-list');
  if (!list) return;
  if (!empleados.length) {
    list.innerHTML = '<div style="padding:16px;color:var(--text-3);font-size:12px">Sin empleados en esta sucursal</div>';
    return;
  }
  list.innerHTML = empleados.map(function(e) {
    var color = avatarColor(e.nombre);
    var ini   = iniciales(e.nombre);
    return '<div class="emp-card" draggable="true" ' +
           'data-id="' + e._id + '" ' +
           'data-nombre="' + escHtml(e.nombre) + '" ' +
           'data-cargo="' + escHtml(e.cargo || '') + '">' +
           '<div class="emp-avatar" style="background:' + color + '">' + escHtml(ini) + '</div>' +
           '<div class="emp-info">' +
             '<div class="emp-name">' + escHtml(e.nombre) + '</div>' +
             '<div class="emp-turno">' + escHtml(e.cargo || '') + '</div>' +
           '</div>' +
           '<i class="ti ti-grip-vertical emp-grip"></i>' +
           '</div>';
  }).join('');

  horInitDragAndDrop();
}

// ── Cuadrícula del editor ─────────────────────────────────────

function horRenderGrid() {
  var tbody = document.getElementById('hor-grid-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  TURNOS_KEYS.forEach(function(t) {
    var tr = document.createElement('tr');
    var tdLabel = document.createElement('td');
    tdLabel.innerHTML = '<div class="turno-label turno-label--' + t.toLowerCase() + '">' + t + '</div>';
    tr.appendChild(tdLabel);

    for (var dia = 0; dia < 7; dia++) {
      var td   = document.createElement('td');
      var celda = gridState.turnos[t][dia];
      td.appendChild(horCrearDropCell(t, dia, celda));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  horValidarConflictos();
  horInitDropZones();
}

function horCrearDropCell(turno, dia, celda) {
  var div = document.createElement('div');
  div.className = 'drop-cell';
  div.dataset.turno = turno;
  div.dataset.dia   = String(dia);

  if (!celda || !celda.empleados || celda.empleados.length === 0) {
    div.classList.add('drop-cell--empty');
  } else {
    div.classList.add('drop-cell--filled');
    celda.empleados.forEach(function(emp) {
      div.appendChild(horCrearDropChip(turno, dia, emp));
    });
    if (celda.indicacion) {
      var ind = document.createElement('div');
      ind.className   = 'chip-indicacion';
      ind.textContent = celda.indicacion;
      div.appendChild(ind);
    }
  }

  return div;
}

function horCrearDropChip(turno, dia, emp) {
  var chip = document.createElement('div');
  chip.className = 'drop-chip';

  var nombre = document.createElement('span');
  nombre.className   = 'drop-chip-name';
  nombre.textContent = emp.nombre;

  var btnNote = document.createElement('button');
  btnNote.className = 'drop-chip-note' + (gridState.turnos[turno][dia].indicacion ? ' has-note' : '');
  btnNote.title     = 'Indicación';
  btnNote.innerHTML = '<i class="ti ti-notes"></i>';
  btnNote.onclick   = (function(t, d, eId) {
    return function(ev) {
      ev.stopPropagation();
      horOpenIndicacion(t, d, eId, btnNote);
    };
  }(turno, dia, emp._id));

  var btnRemove = document.createElement('button');
  btnRemove.className = 'drop-chip-remove';
  btnRemove.title     = 'Quitar';
  btnRemove.innerHTML = '<i class="ti ti-x"></i>';
  btnRemove.onclick   = (function(t, d, eId) {
    return function() { horQuitarEmpleado(t, d, eId); };
  }(turno, dia, emp._id));

  chip.appendChild(nombre);
  chip.appendChild(btnNote);
  chip.appendChild(btnRemove);
  return chip;
}

// ── Drag & drop ───────────────────────────────────────────────
// Lógica de asignación compartida entre el drag nativo (mouse/desktop)
// y el drag táctil (móvil, ver horInitTouchDrag) para no duplicarla.
function horAsignarEmpleadoACelda(empId, empNombre, empCargo, turno, dia) {
  if (!empId || !turno || isNaN(dia)) return;

  // Evitar duplicados en la misma celda
  var celda = gridState.turnos[turno][dia];
  var yaEsta = celda.empleados.some(function(e2) { return String(e2._id) === empId; });
  if (yaEsta) { horToast('El empleado ya está en este turno', 'warning'); return; }

  // Contar cuántos turnos tiene este empleado en este día (sin contar la celda destino)
  var apariciones = 0;
  TURNOS_KEYS.forEach(function(t) {
    if (gridState.turnos[t][dia].empleados.some(function(e2) { return String(e2._id) === empId; })) {
      apariciones++;
    }
  });

  // 3 turnos mismo día: bloquear
  if (apariciones >= 2) {
    horToast(empNombre + ' ya tiene doble turno hoy — no se puede agregar un tercero', 'error');
    return;
  }

  // Agregar empleado a la celda
  celda.empleados.push({ _id: empId, nombre: empNombre, cargo: empCargo });
  if (celda.estado === 'vacio') celda.estado = 'normal';

  // 2 turnos mismo día: avisar pero permitir
  if (apariciones === 1) {
    horToast('⚠ Doble turno: ' + empNombre + ' ya tiene otro turno este día', 'warning');
  }

  horRenderGrid();
}

function horInitDragAndDrop() {
  var cards = document.querySelectorAll('.emp-card');
  cards.forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('empId',     card.dataset.id);
      e.dataTransfer.setData('empNombre', card.dataset.nombre);
      e.dataTransfer.setData('empCargo',  card.dataset.cargo);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', function() {
      card.classList.remove('dragging');
    });

    horInitTouchDrag(card);
  });
}

// El drag-and-drop HTML5 (dragstart/dragover/drop) no dispara en touch
// (iOS/Android). Aquí se reimplementa a mano con touchstart/move/end:
// se sigue el dedo con una tarjeta "fantasma" y, al soltar, se detecta
// la celda debajo con elementFromPoint().
function horInitTouchDrag(card) {
  // El arrastre táctil solo inicia desde el ícono de agarre (⋮⋮), nunca
  // desde el resto de la tarjeta — si no, cualquier intento de hacer
  // scroll con el dedo sobre la lista se interpretaría como un arrastre
  // y bloquearía el scroll normal del panel de equipo.
  var handle = card.querySelector('.emp-grip');
  if (!handle) return;

  var ghost = null;
  var hoverCell = null;
  var startX = 0, startY = 0, dragging = false;
  var UMBRAL = 8; // px de movimiento antes de mostrar el fantasma (solo visual)

  // Quita cualquier fantasma que haya quedado pegado de un arrastre anterior
  // interrumpido (ej. por el pull-to-refresh de Safari cortando el gesto)
  function limpiarFantasmasHuerfanos() {
    document.querySelectorAll('.emp-card-ghost').forEach(function(g) { g.remove(); });
  }

  handle.addEventListener('touchstart', function(e) {
    // preventDefault desde el primer toque: este ícono solo sirve para
    // arrastrar, así que jamás debe dejar que Safari interprete el gesto
    // como scroll o, cerca del borde superior, como pull-to-refresh.
    e.preventDefault();
    limpiarFantasmasHuerfanos();
    var t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    dragging = false;
  }, { passive: false });

  handle.addEventListener('touchmove', function(e) {
    // Siempre, no solo tras el umbral: si se espera, Safari ya pudo haber
    // iniciado su propio gesto (pull-to-refresh) y un preventDefault tardío
    // no lo cancela.
    e.preventDefault();

    var t  = e.touches[0];
    var dx = t.clientX - startX;
    var dy = t.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) < UMBRAL && Math.abs(dy) < UMBRAL) return;
      dragging = true;
      card.classList.add('dragging');
      ghost = card.cloneNode(true);
      ghost.classList.add('emp-card-ghost');
      document.body.appendChild(ghost);
    }

    if (ghost) {
      ghost.style.left = (t.clientX - 100) + 'px';
      ghost.style.top  = (t.clientY - 20) + 'px';
    }

    var el   = document.elementFromPoint(t.clientX, t.clientY);
    var cell = el ? el.closest('.drop-cell') : null;
    if (cell !== hoverCell) {
      if (hoverCell) hoverCell.classList.remove('drop-cell--dragover');
      if (cell)      cell.classList.add('drop-cell--dragover');
      hoverCell = cell;
    }
  }, { passive: false });

  function soltar() {
    card.classList.remove('dragging');
    if (ghost) { ghost.remove(); ghost = null; }
    if (hoverCell) {
      hoverCell.classList.remove('drop-cell--dragover');
      horAsignarEmpleadoACelda(
        card.dataset.id, card.dataset.nombre, card.dataset.cargo,
        hoverCell.dataset.turno, parseInt(hoverCell.dataset.dia, 10)
      );
      hoverCell = null;
    }
    dragging = false;
  }

  handle.addEventListener('touchend', soltar);
  handle.addEventListener('touchcancel', soltar);
}

function horInitDropZones() {
  var cells = document.querySelectorAll('.drop-cell');
  cells.forEach(function(cell) {
    cell.addEventListener('dragover', function(e) {
      e.preventDefault();
      cell.classList.add('drop-cell--dragover');
    });
    cell.addEventListener('dragleave', function() {
      cell.classList.remove('drop-cell--dragover');
    });
    cell.addEventListener('drop', function(e) {
      e.preventDefault();
      cell.classList.remove('drop-cell--dragover');
      horAsignarEmpleadoACelda(
        e.dataTransfer.getData('empId'),
        e.dataTransfer.getData('empNombre'),
        e.dataTransfer.getData('empCargo'),
        cell.dataset.turno,
        parseInt(cell.dataset.dia, 10)
      );
    });
  });
}

// ── Operaciones de cuadrícula ─────────────────────────────────

function horQuitarEmpleado(turno, dia, empId) {
  var celda = gridState.turnos[turno][dia];
  celda.empleados = celda.empleados.filter(function(e) { return String(e._id) !== empId; });
  if (celda.empleados.length === 0) celda.estado = 'normal';
  horRenderGrid();
}

function horValidarConflictos() {
  var hayDoble = false, hayTriple = false;

  for (var dia = 0; dia < 7; dia++) {
    // Contar apariciones de cada empleado en todos los turnos de este día
    var vistos = {};
    TURNOS_KEYS.forEach(function(t) {
      (gridState.turnos[t][dia].empleados || []).forEach(function(emp) {
        vistos[emp._id] = (vistos[emp._id] || 0) + 1;
      });
    });

    var counts = Object.values(vistos);
    if (counts.some(function(n) { return n >= 3; })) hayTriple = true;
    if (counts.some(function(n) { return n === 2; })) hayDoble = true;

    // Marcar celdas y chips según nivel de conflicto
    TURNOS_KEYS.forEach(function(t) {
      var celda = gridState.turnos[t][dia];
      var emps = celda.empleados || [];

      var tieneTriple = emps.some(function(emp) { return (vistos[emp._id] || 0) >= 3; });
      var tieneDoble  = !tieneTriple && emps.some(function(emp) { return (vistos[emp._id] || 0) === 2; });

      if (tieneTriple) celda.estado = 'conflicto';
      else if (tieneDoble) celda.estado = 'doble';
      else if (celda.estado === 'conflicto' || celda.estado === 'doble') celda.estado = 'normal';

      var cell = document.querySelector('.drop-cell[data-turno="' + t + '"][data-dia="' + dia + '"]');
      if (cell) {
        cell.classList.toggle('drop-cell--conflicto', tieneTriple);
        cell.classList.toggle('drop-cell--doble',     tieneDoble && !tieneTriple);

        var chips = cell.querySelectorAll('.drop-chip');
        emps.forEach(function(emp, i) {
          var chip = chips[i];
          if (!chip) return;
          var cnt = vistos[emp._id] || 0;
          chip.classList.toggle('drop-chip--conflicto', cnt >= 3);
          chip.classList.toggle('drop-chip--doble',     cnt === 2);
        });
      }
    });
  }

  var bar = document.getElementById('hor-conflict-bar');
  var msg = document.getElementById('hor-conflict-msg');
  if (bar) {
    bar.classList.toggle('visible', hayDoble || hayTriple);
    if (msg) {
      if (hayTriple) msg.textContent = 'Hay empleados con triple turno — revisa el horario antes de publicar';
      else           msg.textContent = 'Hay empleados con doble turno este día — verifica si es intencional';
    }
  }
}

// ── Modal de indicación ───────────────────────────────────────

function horInitIndicacionTipos() {
  var btns = document.querySelectorAll('.indicacion-tipo-btn');
  btns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      btns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var txt = document.getElementById('indicacion-text');
      if (txt) txt.value = btn.dataset.texto || '';
    });
  });
}

function horOpenIndicacion(turno, dia, empId, anchorEl) {
  indicacionCtx = { turno: turno, dia: dia, empId: empId };
  var modal = document.getElementById('indicacion-modal');
  if (!modal) return;

  // Texto actual
  var txt = document.getElementById('indicacion-text');
  if (txt) txt.value = gridState.turnos[turno][dia].indicacion || '';

  // Limpiar active de tipo-btns
  document.querySelectorAll('.indicacion-tipo-btn').forEach(function(b) {
    b.classList.remove('active');
  });

  // Posicionar cerca del ancla dentro de .hor-shell
  var shell = document.querySelector('.hor-shell');
  var rect  = anchorEl.getBoundingClientRect();
  var shellRect = shell.getBoundingClientRect();

  modal.style.display = '';
  modal.style.top  = (rect.bottom - shellRect.top + 6) + 'px';
  modal.style.left = Math.min(rect.left - shellRect.left, shellRect.width - 300) + 'px';
}
window.horOpenIndicacion = horOpenIndicacion;

function horCloseIndicacion() {
  var modal = document.getElementById('indicacion-modal');
  if (modal) modal.style.display = 'none';
  indicacionCtx = null;
}
window.horCloseIndicacion = horCloseIndicacion;

function horSaveIndicacion() {
  if (!indicacionCtx) return;
  var txt = document.getElementById('indicacion-text');
  var texto = txt ? txt.value.trim() : '';
  gridState.turnos[indicacionCtx.turno][indicacionCtx.dia].indicacion = texto;
  if (texto) gridState.turnos[indicacionCtx.turno][indicacionCtx.dia].estado = 'cambio';
  horCloseIndicacion();
  horRenderGrid();
}
window.horSaveIndicacion = horSaveIndicacion;

// ── Guardar borrador ──────────────────────────────────────────

async function horSaveGrid() {
  if (!gridState.sucursal || !gridState.semana) {
    horToast('No hay horario activo para guardar', 'warning');
    return;
  }
  try {
    var body = {
      sucursal: gridState.sucursal,
      semana:   gridState.semana,
      turnos:   serializarTurnos(),
    };
    var resp = await fetch('/horarios/api/guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'Error');
    if (data.id) gridState.horarioId = data.id;
    horToast('Borrador guardado', 'success');
    // Refrescar datos locales
    await horCargarSemana(horSemana, 'todas');
    horData.horarios = horData.horarios;
  } catch (err) {
    console.error(err);
    horToast('Error al guardar', 'error');
  }
}
window.horSaveGrid = horSaveGrid;

// ── Publicar ──────────────────────────────────────────────────

async function horPublishActive() {
  if (!gridState.horarioId) {
    // Intenta guardar primero para obtener el id
    await horSaveGrid();
    if (!gridState.horarioId) { horToast('Guarda el borrador primero', 'warning'); return; }
  }
  try {
    var resp = await fetch('/horarios/api/publicar/' + gridState.horarioId, { method: 'POST' });
    var data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'Error');
    horToast('Horario publicado', 'success');
    await horCargarSemana(horSemana, 'todas');
    horCloseEditor();
  } catch (err) {
    horToast('Error al publicar', 'error');
  }
}
window.horPublishActive = horPublishActive;

// Publicar desde el topbar (el horario activo en el editor o el único borrador)
async function horPublicarActivo() {
  if (editorAbierto) { horPublishActive(); return; }
  // Publicar todos los borradores de la semana visible
  var borradores = horData.horarios.filter(function(h) { return h.estado === 'borrador'; });
  if (!borradores.length) { horToast('No hay borradores para publicar', 'warning'); return; }
  try {
    await Promise.all(borradores.map(function(h) {
      return fetch('/horarios/api/publicar/' + h._id, { method: 'POST' });
    }));
    horToast(borradores.length + ' horario(s) publicados', 'success');
    await horCargarSemana(horSemana, 'todas');
  } catch {
    horToast('Error al publicar', 'error');
  }
}
window.horPublicarActivo = horPublicarActivo;

// ── Copiar semana anterior ────────────────────────────────────

async function horCopiarSemana() {
  var semOrigen  = addWeeks(horSemana, -1);
  var sucursales = horSucursal === 'todas' ? SUCURSALES : [horSucursal];

  if (!confirm('¿Copiar horario de la semana anterior (' + semanaLabel(semOrigen) + ') a ésta?')) return;

  try {
    var resultados = await Promise.allSettled(
      sucursales.map(async function(suc) {
        var r = await fetch('/horarios/api/copiar-semana', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sucursal: suc, semanaOrigen: semOrigen, semanaDestino: horSemana }),
        });
        return r.ok;
      })
    );
    var ok = resultados.filter(function(r) { return r.status === 'fulfilled' && r.value === true; }).length;
    if (ok > 0) {
      horToast(ok + ' horario(s) copiados como borrador', 'success');
    } else {
      horToast('No había horarios en la semana anterior', 'warning');
    }
    await horCargarSemana(horSemana, 'todas');
  } catch {
    horToast('Error al copiar semana', 'error');
  }
}
window.horCopiarSemana = horCopiarSemana;

// ── Toast ─────────────────────────────────────────────────────

var toastTimer = null;

function horToast(msg, tipo) {
  var toast   = document.getElementById('hor-toast');
  var msgEl   = document.getElementById('hor-toast-msg');
  var iconEl  = document.getElementById('hor-toast-icon');
  if (!toast) return;

  var icons = { success: 'ti-check', error: 'ti-x', warning: 'ti-alert-triangle' };
  toast.className = 'toast toast--' + (tipo || 'success') + ' toast--visible';
  if (iconEl) iconEl.className = 'ti ' + (icons[tipo] || 'ti-check');
  if (msgEl)  msgEl.textContent = msg;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() {
    toast.classList.remove('toast--visible');
  }, 2500);
}
window.horToast = horToast;
