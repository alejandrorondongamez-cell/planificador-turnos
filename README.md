# IT Planner v5 PRO

## Cambios principales
- Botón visible de desbloqueo de edición.
- Modo lectura por defecto para técnicos.
- Botones de administración ocultos hasta desbloquear edición.
- Gestión de vacaciones antes de generación.
- Generador automático que respeta vacaciones, festivos y asignaciones manuales si no se marca sobrescribir.
- Festivos por tipo con color y leyenda: cierre global, nacional, autonómico, local.
- Reglas de cobertura: normal 6/2; nacional 2/2; autonómico/local 4/2; cierre global 0/0.
- Reporte de horas admin-only: mañana, tarde, festivos, nacionales, autonómicos, locales, total.
- Guardado en GitHub mediante token introducido en sesión, no persistido.

## Configuración obligatoria
1. Editar `data/config.json`:
   - `adminPasswordHash`
   - `github.owner`
   - `github.repo`
2. Generar hash con `hash.html`.
3. Subir todos los ficheros a GitHub Pages.

## Seguridad
- No guardar contraseña real en código.
- No guardar tokens en el repo.
- El bloqueo por contraseña es control de interfaz en frontend; el control fuerte de escritura lo da GitHub.
- Recomendado: repo privado / GitHub Pages privado si vuestra organización dispone de GitHub Enterprise Cloud.
