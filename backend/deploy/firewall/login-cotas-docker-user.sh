#!/usr/bin/env bash
# Capa de red (defensa en profundidad) para LOGIN COTAS en el host del backend.
#
# La restricción funcional ya la aplica el backend (LOGIN_COTAS_ALLOWED_CIDRS sobre el peer TCP).
# Este script, además, descarta en el firewall los paquetes REENVIADOS hacia el puerto de la API
# publicado por Docker cuando el origen no es la red corporativa.
#
# ATENCIÓN: filtra TODO ese puerto, no solo /auth/login. Úselo únicamente si ningún cliente
# externo debe llamar a ese puerto directamente. El tráfico público debe entrar por Nginx
# (443 → 127.0.0.1:PUERTO); ese tramo es local al host y no atraviesa DOCKER-USER.
# Verifique en el host antes de aplicar a producción (no se probó en el servidor real).
#
# Uso (root, en el host del backend):
#   CORP_CIDR=10.10.0.0/16 API_PORT=3100 bash login-cotas-docker-user.sh               # simulación
#   CORP_CIDR=10.10.0.0/16 API_PORT=3100 APPLY=true bash login-cotas-docker-user.sh    # aplica
#   CORP_CIDR=10.10.0.0/16 API_PORT=3100 APPLY=true ACTION=remove bash login-cotas-docker-user.sh
#
# No toca XUI, Nginx, PostgreSQL ni Redis. Las reglas no persisten tras reiniciar el host salvo
# que se guarden con el mecanismo del sistema (iptables-persistent / nftables).
set -eu

corp_cidr=${CORP_CIDR:-10.10.0.0/16}
api_port=${API_PORT:-3100}
action=${ACTION:-add}
apply=${APPLY:-false}

rule=(DOCKER-USER -p tcp -m conntrack --ctorigdstport "$api_port" ! -s "$corp_cidr" \
  -m comment --comment login-cotas -j DROP)

run() {
  if [ "$apply" = "true" ]; then
    "$@"
  else
    printf '[simulación] %s\n' "$*"
  fi
}

case "$action" in
  add)
    if iptables -C "${rule[@]}" 2>/dev/null; then
      echo "La regla login-cotas ya existe."
    else
      run iptables -I "${rule[@]}"
    fi
    ;;
  remove)
    if iptables -C "${rule[@]}" 2>/dev/null; then
      run iptables -D "${rule[@]}"
    else
      echo "La regla login-cotas no existe."
    fi
    ;;
  *)
    echo "ACTION debe ser add o remove." >&2
    exit 2
    ;;
esac
echo "login-cotas: permitir $corp_cidr hacia tcp/$api_port, descartar el resto (ACTION=$action APPLY=$apply)."
