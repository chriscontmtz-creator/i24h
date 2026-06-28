-- =============================================================
--  MIGRACIÓN: Empleados + Auditorías
--  Referencia SQL (el backend actual usa MongoDB/Mongoose).
--  Ejecutar en PostgreSQL si se migra a PG en el futuro.
-- =============================================================

CREATE TABLE empleados (
  id                     SERIAL PRIMARY KEY,
  nombre                 VARCHAR(100) NOT NULL,
  sucursal               VARCHAR(50)  CHECK (sucursal IN ('Simon Bolivar','Centro','Sureste')),
  lider_id               INTEGER      REFERENCES empleados(id),
  coordinador_id         INTEGER      REFERENCES empleados(id),
  rol                    VARCHAR(30)  DEFAULT 'vendedor',
  turnos                 TEXT[],      -- ej: '{T1,T2}'
  puntos_acumulados      INTEGER      DEFAULT 0,
  ventas_extraordinarias DECIMAL(10,2) DEFAULT 0,
  nivel_bono             VARCHAR(10)  DEFAULT 'ninguno'
                           CHECK (nivel_bono IN ('ninguno','bronce','plata','oro')),
  activo                 BOOLEAN      DEFAULT true,
  created_at             TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE auditorias (
  id               SERIAL PRIMARY KEY,
  empleado_id      INTEGER REFERENCES empleados(id) NOT NULL,
  fecha            DATE    DEFAULT CURRENT_DATE,
  ventas           SMALLINT CHECK (ventas           BETWEEN 1 AND 10),
  actitud          SMALLINT CHECK (actitud          BETWEEN 1 AND 10),
  cumplimiento     SMALLINT CHECK (cumplimiento     BETWEEN 1 AND 10),
  asistencia       SMALLINT CHECK (asistencia       BETWEEN 1 AND 10),
  limpieza         SMALLINT CHECK (limpieza         BETWEEN 1 AND 10),
  atencion_cliente SMALLINT CHECK (atencion_cliente BETWEEN 1 AND 10),
  eficiencia       SMALLINT CHECK (eficiencia       BETWEEN 1 AND 10),
  promedio         DECIMAL(4,2) GENERATED ALWAYS AS (
    (ventas+actitud+cumplimiento+asistencia+limpieza+atencion_cliente+eficiencia)::decimal/7
  ) STORED,
  puntos_otorgados INTEGER,
  lider_auditor_id INTEGER REFERENCES empleados(id),
  UNIQUE (empleado_id, fecha)
);

-- Índices de consulta frecuente
CREATE INDEX idx_empleados_sucursal ON empleados(sucursal);
CREATE INDEX idx_auditorias_fecha   ON auditorias(fecha);
CREATE INDEX idx_auditorias_emp     ON auditorias(empleado_id);
