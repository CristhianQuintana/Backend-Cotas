#!/usr/bin/env bash
set -eu

mode=${1:-}
image=${IMAGE:-}
env_file=${ENV_FILE:-}
state_dir=${STATE_DIR:-/opt/cotas/state}
backup_dir=${BACKUP_DIR:-/opt/cotas/backups}
compose_dir=${COMPOSE_DIR:-}

if [ "$mode" != "deploy" ] && [ "$mode" != "rollback" ]; then
  echo "Uso: server-deploy.sh deploy|rollback" >&2
  exit 2
fi
if [ -z "$compose_dir" ] || [ ! -f "$compose_dir/docker-compose.yml" ]; then
  echo "COMPOSE_DIR no contiene docker-compose.yml." >&2
  exit 2
fi
case "$image" in
  ghcr.io/*/backend-cotas:[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "IMAGE debe ser ghcr.io/<propietario>/backend-cotas:<sha de 40 hexadecimales>." >&2
    exit 2
    ;;
esac
if [ ! -f "$env_file" ]; then
  echo "No existe el entorno del servidor. No se copia ningún secreto al repositorio." >&2
  exit 2
fi
if grep -q 'local_only_dev_password' "$env_file" || grep -q 'CHANGE_ME' "$env_file"; then
  echo "El entorno del servidor aún tiene la contraseña local o un marcador CHANGE_ME." >&2
  exit 2
fi

read_env() {
  key=$1
  fallback=$2
  line=$(grep -E "^${key}=" "$env_file" | tail -n 1 || true)
  value=${line#*=}
  value=${value%\"}
  value=${value#\"}
  value=${value%\'}
  value=${value#\'}
  if [ -z "$value" ]; then
    printf '%s' "$fallback"
  else
    printf '%s' "$value"
  fi
}

install -d -m 700 "$state_dir" "$backup_dir"
cd "$compose_dir"
ln -sfn "$env_file" .env

db_user=$(read_env POSTGRES_USER cotas)
db_name=$(read_env POSTGRES_DB cotas_dev)
api_port=$(read_env BACKEND_PORT 3100)

if docker compose ps --format '{{.Service}} {{.Status}}' | grep -q '^postgres Up'; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  docker compose exec -T postgres pg_dump -U "$db_user" --format=custom --file=/tmp/cotas.dump "$db_name"
  docker compose cp "postgres:/tmp/cotas.dump" "$backup_dir/cotas-${stamp}.dump"
  docker compose exec -T postgres rm -f /tmp/cotas.dump
  # Solo el directorio raíz de copias: no descender a subcarpetas (p. ej. restos
  # ajenos bajo backups/) que el runner no debe leer.
  while IFS= read -r old; do
    rm -f "$old"
  done < <(
    find "$backup_dir" -mindepth 1 -maxdepth 1 -type f -name 'cotas-*.dump' -printf '%T@ %p\n' \
      | sort -nr \
      | awk 'NR>7 { print $2 }'
  )
  echo "Copia previa guardada. No se imprime su ruta completa en el resumen remoto."
else
  echo "PostgreSQL no estaba en marcha. No hay copia previa que tomar."
fi

if [ -f "$state_dir/current-image" ]; then
  cp "$state_dir/current-image" "$state_dir/previous-image"
fi

if ! docker pull "$image"; then
  echo "No se pudo descargar la imagen. Compruebe que publish terminó en verde para este SHA y que el paquete GHCR está ligado al repositorio con lectura para Actions." >&2
  exit 1
fi
docker tag "$image" cotas-backend:local
if [ "$mode" = "rollback" ]; then
  export RUN_MIGRATIONS=false
  echo "Reversión de la imagen. No se aplican migraciones y no se restaura la base."
else
  export RUN_MIGRATIONS=true
fi

docker compose up -d --no-build

healthy=0
attempt=0
while [ "$attempt" -lt 24 ]; do
  status=$(docker compose ps --format '{{.Service}} {{.Status}}' || true)
  if printf '%s\n' "$status" | grep -q '^backend .*healthy' \
    && printf '%s\n' "$status" | grep -q '^postgres .*healthy'; then
    healthy=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 5
done

base="http://127.0.0.1:${api_port}"
live=$(curl -sS -o /dev/null -w '%{http_code}' "${base}/api/v1/health/live" || true)
ready=$(curl -sS -o /dev/null -w '%{http_code}' "${base}/api/v1/health/ready" || true)
anonymous=$(curl -sS -o /dev/null -w '%{http_code}' "${base}/api/v1/catalog/live/categories" || true)
if [ "$healthy" -ne 1 ] || [ "$live" != "200" ] || [ "$ready" != "200" ] || [ "$anonymous" != "401" ]; then
  echo "Salud: contenedores=${healthy} live=${live:-fallo} ready=${ready:-fallo} anon=${anonymous:-fallo}" >&2
  docker compose stop backend || true
  printf '%s %s %s failed\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$mode" "$image" >> "$state_dir/deployments.log"
  echo "La salud no respondió. El backend quedó detenido. PostgreSQL y el volumen cotas_pg siguen en su sitio." >&2
  if [ -f "$state_dir/previous-image" ]; then
    echo "La imagen anterior registrada no se vuelve a activar sola." >&2
  fi
  exit 1
fi

printf '%s\n' "$image" > "$state_dir/current-image"
printf '%s %s %s ok\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$mode" "$image" >> "$state_dir/deployments.log"
docker image prune -f >/dev/null
echo "Despliegue correcto."
