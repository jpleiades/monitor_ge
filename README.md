# Monitor GlobalEduca

Página de estado de la plataforma GE en el colegio de pruebas **demo02**. Cada 10 minutos GitHub Actions abre los cinco módulos con el usuario `demo02_monitor`, guarda el resultado de las últimas 24 horas y, si algo falla, hace una captura de pantalla y envía un correo con asunto **CAIDA** a javier.garrido@globaleduca.com.

Página publicada: https://jpleiades.github.io/monito_ge/

| Módulo   | URL comprobada                          |
|----------|-----------------------------------------|
| PSP      | https://psp.globaleduca.com/demo02      |
| Meta     | https://meta.globaleduca.com/demo02     |
| Portal   | https://portal.globaleduca.com/demo02   |
| Cuaderno | https://cuaderno.globaleduca.com/demo02 |
| Admin    | https://admin.globaleduca.com/demo02    |

Colores: verde, todos los módulos funcionan; naranja, falla alguno; rojo, no responde ninguno; gris, no hubo comprobación en ese tramo.

## Instalación (todo desde la web de GitHub)

### 1. Crear el repositorio
En https://github.com/new: nombre `monito_ge`, **Public**, sin README. Pulsa *Create repository*.

### 2. Subir los archivos
En el repositorio vacío pulsa *uploading an existing file* y arrastra el **contenido** de la carpeta descomprimida (no la carpeta en sí): `.github`, `docs`, `monitor`, `package.json` y `README.md`. Pulsa *Commit changes*.

Comprueba que aparece la carpeta `.github`. Si no aparece, créala a mano: *Add file › Create new file*, escribe como nombre `.github/workflows/monitor.yml`, pega el contenido de ese archivo y guarda.

### 3. Guardar las claves (Settings › Secrets and variables › Actions › New repository secret)

| Secreto       | Valor                                                        |
|---------------|--------------------------------------------------------------|
| `GE_PASSWORD` | Contraseña de demo02_monitor                                 |
| `SMTP_HOST`   | Servidor de correo (ver paso 6)                              |
| `SMTP_PORT`   | `587` (o `465`)                                              |
| `SMTP_USER`   | Buzón que envía las alertas                                  |
| `SMTP_PASS`   | Contraseña o contraseña de aplicación de ese buzón           |
| `MAIL_FROM`   | Opcional, remitente visible (por defecto `SMTP_USER`)        |

Los secretos no se ven en el código ni en los registros de ejecución.

### 4. Permisos y página
- *Settings › Actions › General › Workflow permissions*: marca **Read and write permissions** y guarda.
- *Settings › Pages*: *Source* = **Deploy from a branch**, rama `main`, carpeta `/docs`. Guarda.

### 5. Primera comprobación
*Actions › Monitor GlobalEduca › Run workflow*. En 2-3 minutos debe aparecer la primera barra en la página. A partir de ahí se ejecuta solo cada 10 minutos.

### 6. Correo de alerta
- **Microsoft 365**: `SMTP_HOST` = `smtp.office365.com`, puerto `587`. El buzón debe tener activado *SMTP AUTH* (en muchos tenants viene desactivado; lo activa el administrador en el centro de administración de Microsoft 365, en el buzón › Correo › Administrar aplicaciones de correo electrónico).
- **Google Workspace / Gmail**: `SMTP_HOST` = `smtp.gmail.com`, puerto `465`, y en `SMTP_PASS` una contraseña de aplicación (requiere verificación en dos pasos).

Lo recomendable es un buzón dedicado (p. ej. monitor@globaleduca.com). El correo se envía cuando empieza una caída o cuando cambia qué módulos fallan; no se repite cada 10 minutos mientras dura la misma caída. Lleva adjuntas las capturas.

### 7. Botón «Verificar ahora»
Lanza una comprobación al momento. Necesita un token de GitHub que se guarda solo en tu navegador:
1. GitHub › tu foto › *Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token*.
2. *Repository access*: **Only select repositories** › `monito_ge`.
3. *Permissions › Repository permissions*: **Actions: Read and write**, **Contents: Read-only**.
4. Copia el token, abre la página, pulsa *Verificar ahora* y pégalo.

Sin token, el botón te lleva a GitHub Actions para lanzarlo con *Run workflow*.

## Si el primer resultado sale en naranja o rojo
El script rellena el usuario y la contraseña y pulsa «Iniciar sesión» (nunca los botones de Google o Microsoft). Como la plataforma solo permite una sesión activa por usuario, al terminar cada módulo intenta pulsar «Cerrar sesión» o «Salir»; por eso conviene que `demo02_monitor` no lo use ninguna persona. Para usar otro usuario, cambia `user` en `monitor/config.json` o crea la variable `GE_USER` en *Settings › Secrets and variables › Actions › Variables*. Si el error dice que *el acceso no se completó*, mira la captura y ajusta los selectores en `monitor/config.json` (`selectors.user`, `selectors.password`, `selectors.submit`). Si el acceso falla, el script no reintenta en los demás módulos para no bloquear la cuenta.

En `config.json` también se pueden cambiar las URLs, el destinatario, el asunto, los textos que se consideran error (`errorTexts`) y el tiempo máximo de espera.

## A tener en cuenta
- **Repositorio público**: las Actions son gratuitas sin límite y GitHub Pages funciona en el plan gratuito. Las capturas de error son públicas, así que conviene que demo02 solo contenga datos ficticios. Un repositorio privado necesita GitHub Pro y consume unos 8.000 minutos de Actions al mes (el plan gratuito incluye 2.000).
- **Puntualidad**: GitHub no garantiza la hora exacta de las ejecuciones programadas; en horas de mucha carga pueden retrasarse o saltarse alguna. Las barras grises indican tramos sin comprobación.
- Se guardan solo las últimas 24 horas de resultados y capturas.
