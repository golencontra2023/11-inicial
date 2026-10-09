/* =====================================================================
   CONFIGURACIÓN DEL TABLERO – Gol en Contra
   Este es el único archivo que normalmente hace falta tocar.
   ===================================================================== */

const CONFIG = {

  // ---------- Guardado compartido ----------
  // URL de Firebase Realtime Database (ver README).
  // Si queda vacío, los cambios se guardan solo en este navegador.
  DB_URL: "https://formaciontitular-1b05e-default-rtdb.firebaseio.com",

  // Clave del técnico para editar el tablero. ¡Cambiala!
  PIN: "gec2026",

  // Cada cuántos milisegundos se buscan cambios en la base (5000 = 5 s).
  REFRESCO_MS: 5000,

  // ---------- Formación ----------
  // Esquema con el que arranca un tablero nuevo.
  ESQUEMA_INICIAL: "4-3-3",

  // Botones de esquemas rápidos.
  ESQUEMAS: ["4-3-3", "4-2-3-1", "4-4-2", "3-5-2"],

  // ---------- Torneo ----------
  // Los equipos se identifican por su número (posición en la lista).
  // Zona A = equipos 1 a 8 · Zona B = equipos 9 a 16.
  // OJO: no cambies el orden una vez cargados resultados,
  // porque los resultados se guardan usando estos números.
  EQUIPOS: [
    "",               // 0  (sin uso)
    "DE ZURDA",       // 1   ─┐
    "MALVINAS",       // 2    │
    "TIMBA",          // 3    │
    "GOL EN CONTRA",  // 4    │ Zona A
    "TERCER TIEMPO",  // 5    │
    "AGRIMENSURA",    // 6    │
    "GEOLOGIA",       // 7    │
    "F90",            // 8   ─┘
    "NECAXA",         // 9   ─┐
    "ADOVE",          // 10   │
    "DESCARTE",       // 11   │
    "CENTRAL",        // 12   │ Zona B
    "AL COSTADO",     // 13   │
    "DEP. LA VERNA",  // 14   │
    "INTER",          // 15   │
    "LIBRE",          // 16  ─┘
  ],

  // Número de nuestro equipo en la lista de arriba.
  MI_EQUIPO: 4,

  // Fixture: una fila por fecha → [partidos Zona A, partidos Zona B].
  // Cada partido se escribe "local-visitante" con los números de equipo.
  FIXTURE: [
    /* Fecha 1 */ ["1-8 2-7 3-6 4-5", "9-16 10-15 11-14 12-13"],
    /* Fecha 2 */ ["1-7 8-6 2-5 3-4", "9-15 16-14 10-13 11-12"],
    /* Fecha 3 */ ["1-6 7-5 8-4 2-3", "9-14 15-13 16-12 10-11"],
    /* Fecha 4 */ ["1-5 6-4 7-3 8-2", "9-13 14-12 15-11 16-10"],
    /* Fecha 5 */ ["1-4 5-3 6-2 7-8", "9-12 13-11 14-10 15-16"],
    /* Fecha 6 */ ["1-3 4-2 5-8 6-7", "9-11 12-10 13-16 14-15"],
    /* Fecha 7 */ ["1-2 3-8 4-7 5-6", "9-10 11-16 12-15 13-14"],
  ],

  // Resultados ya jugados con los que arranca un tablero nuevo.
  // Formato: "fecha:local-visitante": [goles local, goles visitante]
  RESULTADOS_INICIALES: {
    "1:1-8": [0, 3],      // DE ZURDA vs F90
    "1:2-7": [2, 1],      // MALVINAS vs GEOLOGIA
    "1:3-6": [1, 4],      // TIMBA vs AGRIMENSURA
    "1:4-5": [0, 1],      // GOL EN CONTRA vs TERCER TIEMPO
    "2:1-7": [4, 0],      // DE ZURDA vs GEOLOGIA
    "2:8-6": [3, 1],      // F90 vs AGRIMENSURA
    "2:2-5": [2, 0],      // MALVINAS vs TERCER TIEMPO
    "2:3-4": [0, 7],      // TIMBA vs GOL EN CONTRA
    "3:1-6": [4, 1],      // DE ZURDA vs AGRIMENSURA
    "3:7-5": [1, 3],      // GEOLOGIA vs TERCER TIEMPO
    "3:8-4": [1, 2],      // F90 vs GOL EN CONTRA
    "3:2-3": [6, 0],      // MALVINAS vs TIMBA
  },

  DESCUENTOS: {
  4: 1,   // Equipo 4 - Gol en Contra: -1 punto (Por no pagar a tiempo una cuota)
  },
   
};
