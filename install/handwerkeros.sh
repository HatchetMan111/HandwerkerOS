#!/usr/bin/env bash
set -euo pipefail
set -o errtrace

APP="handwerkeros"
APP_DIR="/opt/handwerkeros"
APP_PORT="8080"
GITHUB_RAW="https://raw.githubusercontent.com/HatchetMan111/HandwerkerOS/main"
REPO_URL="${REPO_URL:-https://github.com/HatchetMan111/HandwerkerOS.git}"
CTID="${CTID:-}"
STORAGE="${STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
CORES="${CORES:-2}"
RAM="${RAM:-2048}"
SWAP="${SWAP:-512}"
DISK="${DISK:-8}"
RUN_TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="/tmp/${APP}-install-${RUN_TIMESTAMP}.log"
CREATED_CT=""
MODE="install"

exec > >(tee -a "$LOG_FILE") 2>&1

info() { printf "\033[1;32m[INFO]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
step() { printf "\n\033[1;36m=== %s ===\033[0m\n" "$*"; }

gen_password() {
  local raw
  raw="$(head -c 48 /dev/urandom | base64 | tr -d '+/=')"
  printf '%s' "${raw:0:16}"
}

first_line() {
  local block="$1"
  printf '%s' "${block%%$'\n'*}"
}

banner() {
  echo "============================================================"
  echo " HandwerkerOS Installer (Proxmox LXC)"
  echo " Repo: ${REPO_URL}"
  echo " Log : ${LOG_FILE}"
  echo "============================================================"
}

err_handler() {
  local exit_code=$?
  local line_no=${1:-?}
  local failed_cmd=${2:-?}
  echo
  echo "============================================================"
  echo " HandwerkerOS Installation FEHLGESCHLAGEN"
  echo "============================================================"
  echo "Exit Code : ${exit_code}"
  echo "Zeile     : ${line_no}"
  echo "Befehl    : ${failed_cmd}"
  echo "Modus     : ${MODE} (CT: ${CREATED_CT:-keines})"
  if [ -n "${CREATED_CT}" ]; then
    echo "--- CT-Status ---"
    pct status "${CREATED_CT}" 2>/dev/null || true
    echo "--- journalctl (letzte 40 Zeilen) ---"
    pct exec "${CREATED_CT}" -- journalctl -u handwerkeros.service -n 40 --no-pager 2>/dev/null || true
  fi
  echo "--- Letzte Logzeilen ---"
  tail -n 15 "${LOG_FILE}" 2>/dev/null || true
  echo "Vollständiges Log: ${LOG_FILE}"
  echo "Erneut mit Debug:"
  echo "  bash -x <(wget -qLO - ${GITHUB_RAW}/install/${APP}.sh)"
  echo "============================================================"
}
trap 'err_handler $LINENO "$BASH_COMMAND"' ERR

check_prerequisites() {
  step "Pruefungen"
  [ "$(id -u)" -eq 0 ] || { echo "Nicht root. Abbruch."; exit 1; }
  command -v pct >/dev/null || { echo "pct nicht gefunden – kein Proxmox VE Host? Abbruch."; exit 1; }
  pveversion >/dev/null 2>&1 || { echo "pveversion fehlgeschlagen – kein Proxmox VE Host? Abbruch."; exit 1; }
  info "Root OK, Proxmox VE gefunden: $(pveversion)"
}

get_next_ctid() {
  local next
  next="$(pvesh get /cluster/nextid 2>/dev/null || echo "")"
  [ -z "${next}" ] && next=100
  while pct status "${next}" >/dev/null 2>&1 || qm status "${next}" >/dev/null 2>&1; do
    next=$((next + 1))
  done
  echo "${next}"
}

find_existing_ct() {
  local ct conf
  for ct in $(pct list 2>/dev/null | awk 'NR>1 {print $1}'); do
    conf="$(pct config "${ct}" 2>/dev/null || true)"
    if grep -q "hostname: ${APP}$" <<<"${conf}"; then
      echo "${ct}"
      return 0
    fi
  done
  return 1
}

resolve_ctid_and_mode() {
  local existing
  existing="$(find_existing_ct || true)"
  if [ -n "${CTID}" ] && pct status "${CTID}" >/dev/null 2>&1; then
    MODE="update"
    warn "CT ${CTID} existiert bereits – Update-Modus."
  elif [ -z "${CTID}" ] && [ -n "${existing}" ]; then
    MODE="update"
    CTID="${existing}"
    CREATED_CT="${CTID}"
    warn "Bestehende ${APP}-CT gefunden (${CTID}) – Update-Modus. Neuinstallation erzwinge via CTID_NEU=1 oder CT loeschen."
  else
    MODE="install"
    [ -z "${CTID}" ] && CTID="$(get_next_ctid)"
  fi
}

download_template() {
  step "Debian-Template"
  pveam update >/dev/null 2>&1 || warn "pveam update fehlgeschlagen (offline?) – nutze lokales Template falls vorhanden."
  local template sorted
  sorted="$(pveam available --section system 2>/dev/null | awk '/debian-12-standard/ {print $2}' | sort -rV)" || sorted=""
  template="$(first_line "${sorted}")"
  [ -z "${template}" ] && template="debian-12-standard_12.7-1_amd64.tar.zst"
  if pveam list "${STORAGE}" 2>/dev/null | grep -q "debian-12-standard"; then
    info "Template bereits lokal vorhanden."
  else
    info "Lade Template ${template} auf Storage ${STORAGE}..."
    pveam download "${STORAGE}" "${template}"
  fi
  TEMPLATE="${template}"
  info "Template: ${TEMPLATE}"
}

create_container() {
  step "Erstelle LXC ${CTID} (unprivilegiert, onboot)"
  local root_pw
  root_pw="$(gen_password)"
  pct create "${CTID}" "${STORAGE}:vztmpl/${TEMPLATE}" \
    --hostname "${APP}" \
    --description "HandwerkerOS - lokale Dokumentationsplattform" \
    --unprivileged 1 \
    --cores "${CORES}" \
    --memory "${RAM}" \
    --swap "${SWAP}" \
    --rootfs "${STORAGE}:${DISK}" \
    --net0 "name=net0,bridge=${BRIDGE},ip=dhcp,firewall=0" \
    --onboot 1 \
    --start 1 \
    --password "${root_pw}" \
    >/dev/null
  CREATED_CT="${CTID}"
  info "CT ${CTID} erstellt und gestartet. Root-Passwort: ${root_pw}"
}

ensure_started() {
  local state
  state="$(pct status "${CTID}" 2>/dev/null | awk '{print $2}')"
  if [ "${state}" != "running" ]; then
    info "Starte CT ${CTID}..."
    pct start "${CTID}"
    sleep 3
  fi
}

wait_for_network() {
  step "Warte auf Netzwerk im CT"
  local i
  for i in $(seq 1 30); do
    if pct exec "${CTID}" -- getent hosts deb.debian.org >/dev/null 2>&1; then
      info "Netzwerk OK nach ${i}s."
      return 0
    fi
    sleep 1
  done
  echo "Kein Netzwerk im CT nach 30s. Abbruch."
  exit 1
}

write_inner_script() {
  cat >"/tmp/${APP}-inner-${RUN_TIMESTAMP}.sh" <<'INNER'
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive DEBCONF_NONINTERACTIVE_SEEN=true
export LC_ALL=C LANG=C
APP_PORT="8080"
APP_DIR="/opt/handwerkeros"

step() { printf "\n=== %s ===\n" "$*"; }

step "Systempakete"
apt-get update -qq
apt-get install -yqq python3 python3-venv git curl ca-certificates >/dev/null
python3 --version

step "Benutzer & Verzeichnisse"
id -u handwerkeros >/dev/null 2>&1 || useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin handwerkeros
mkdir -p "${APP_DIR}/storage/data" "${APP_DIR}/storage/files"

step "Anwendungscode"
SRC_TMP="$(mktemp -d)"
git clone --quiet --depth 1 "__REPO_URL__" "${SRC_TMP}/src"
find "${APP_DIR}" -mindepth 1 -maxdepth 1 ! -name storage -exec rm -rf {} +
cp -a "${SRC_TMP}/src/." "${APP_DIR}/"
rm -rf "${SRC_TMP}"
cd "${APP_DIR}"

step "Python-Umgebung"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r requirements-runtime.txt

step "systemd-Unit"
install -m 644 systemd/handwerkeros.service /etc/systemd/system/handwerkeros.service
OVERRIDE_DIR="/etc/systemd/system/handwerkeros.service.d"
if [ -f "${OVERRIDE_DIR}/override.conf" ] && grep -q "HANDWERK_ADMIN_PASSWORD" "${OVERRIDE_DIR}/override.conf"; then
  rm -f "${OVERRIDE_DIR}/override.conf"
fi
if [ -f "${APP_DIR}/storage/data/admin_password" ]; then
  rm -f "${APP_DIR}/storage/data/admin_password"
fi
chown -R handwerkeros:handwerkeros "${APP_DIR}/storage"
systemctl daemon-reload
systemctl enable handwerkeros >/dev/null 2>&1
systemctl restart handwerkeros

step "Health Check (bis zu 30s)"
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
    echo "Gesund nach ${i}s: $(curl -sf http://127.0.0.1:${APP_PORT}/health)"
    exit 0
  fi
  sleep 1
done
echo "Dienst nicht gesund – Diagnose:"
journalctl -u handwerkeros.service -n 60 --no-pager
exit 1
INNER
}

run_inner_install() {
  step "Installation im CT ${CTID}"
  local inner="/tmp/${APP}-inner-${RUN_TIMESTAMP}.sh"
  write_inner_script
  sed -i "s|__REPO_URL__|${REPO_URL}|g" "${inner}"
  bash -n "${inner}"
  pct push "${CTID}" "${inner}" "/tmp/${APP}-inner.sh" >/dev/null
  pct exec "${CTID}" -- chmod +x "/tmp/${APP}-inner.sh"
  if pct exec "${CTID}" -- "/tmp/${APP}-inner.sh"; then
    info "In-Container-Installation erfolgreich."
  else
    echo "Inner-Script fehlgeschlagen."
    exit 1
  fi
}

verify_installation() {
  step "Verifikation"
  pct exec "${CTID}" -- systemctl is-active --quiet handwerkeros
  info "systemd-Dienst: aktiv"
  pct exec "${CTID}" -- curl -sf "http://127.0.0.1:${APP_PORT}/health" >/dev/null
  info "Health-Endpoint: erreichbar"
  local ct_ip
  ct_ip="$(pct exec "${CTID}" -- hostname -I 2>/dev/null | awk '{print $1}')"
  [ -z "${ct_ip}" ] && ct_ip="<CT-IP unbekannt – bitte pruefen>"
  echo
  echo "============================================================"
  echo " HandwerkerOS erfolgreich installiert (Modus: ${MODE})"
  echo "============================================================"
  echo " Web-UI      : http://${ct_ip}:${APP_PORT}"
  echo " API-Doku    : http://${ct_ip}:${APP_PORT}/docs"
  echo " Health      : http://${ct_ip}:${APP_PORT}/health"
  echo " ++++++++++++++++++++++++++++++++++++++++++++"
  echo "  START-LOGIN   Benutzername: admin"
  echo "                Passwort    : admin"
  echo "  -> nach dem ersten Login im Tab 'Admin'"
  echo "     das Passwort sofort aendern!"
  echo " ++++++++++++++++++++++++++++++++++++++++++++"
  echo " CT          : ${CTID} (unprivilegiert, onboot=1)"
  echo " Update      : diesen Einzeiler erneut ausfuehren"
  echo " Deinstall   : pct stop ${CTID} && pct destroy ${CTID}"
  echo " Log         : ${LOG_FILE}"
  echo "============================================================"
}

main() {
  banner
  check_prerequisites
  resolve_ctid_and_mode
  if [ "${MODE}" = "install" ]; then
    download_template
    create_container
    wait_for_network
  else
    ensure_started
    wait_for_network
  fi
  run_inner_install
  verify_installation
}

main "$@"
