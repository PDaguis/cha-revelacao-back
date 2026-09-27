#!/usr/bin/env bash
#
# Zera a festa: apaga os palpites e as fotos — depois de guardar uma cópia.
#
#   ./aws/zerar.sh            apaga tudo
#   ./aws/zerar.sh palpites   só os palpites
#   ./aws/zerar.sh fotos      só as fotos
#
# Feito para ser rodado com pressa, no meio da festa, então: ele descobre
# sozinho o endereço da API e o nome do bucket, mostra o que vai apagar antes
# de apagar, baixa uma cópia de tudo e só aceita como confirmação a palavra
# ZERAR digitada inteira. Cancelar não mexe em nada.

set -euo pipefail

REGIAO="${REGIAO:-us-east-2}"
API_NOME="${API_NOME:-cha-revelacao}"
O_QUE="${1:-tudo}"

case "$O_QUE" in
  tudo|palpites|fotos) ;;
  *) echo "Uso: ./aws/zerar.sh [tudo|palpites|fotos]"; exit 1 ;;
esac

# ---------- confere o que precisa estar pronto ----------
command -v aws >/dev/null 2>&1 || { echo "A AWS CLI não está instalada."; exit 1; }

if ! conta=$(aws sts get-caller-identity --query Account --output text 2>/dev/null); then
  echo "A AWS CLI não está conectada. Rode: aws configure"
  exit 1
fi

api_id=$(aws apigatewayv2 get-apis --region "$REGIAO" \
  --query "Items[?Name=='$API_NOME'].ApiId | [0]" --output text)
if [ "$api_id" = "None" ] || [ -z "$api_id" ]; then
  echo "Não achei o API Gateway $API_NOME em $REGIAO."
  exit 1
fi
endereco="https://$api_id.execute-api.$REGIAO.amazonaws.com"

sufixo=$(printf %s "$conta" | openssl dgst -sha1 -hex | sed 's/.*[= ]//' | cut -c1-8)
BUCKET="${BUCKET:-cha-revelacao-fotos-$sufixo}"

# ---------- o que tem hoje ----------
# o "aws s3 ls" sai com erro quando não acha nada, e com set -e isso derrubaria
# o script justamente no caso mais provável: rodar com tudo já vazio
contar_fotos() {
  local achou
  achou=$(aws s3 ls "s3://$BUCKET/t/" --recursive --region "$REGIAO" 2>/dev/null || true)
  if [ -z "$achou" ]; then echo 0; else printf '%s\n' "$achou" | wc -l | tr -d ' '; fi
}

contar_palpites() {
  curl -s --max-time 20 "$endereco/votos" \
    | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo "?"
}

palpites=$(contar_palpites)
fotos=$(contar_fotos)

echo
echo "Conta $conta, região $REGIAO"
echo "  API     $endereco"
echo "  bucket  $BUCKET"
echo
echo "Hoje tem:"
[ "$O_QUE" != "fotos" ]    && echo "  $palpites palpite(s)"
[ "$O_QUE" != "palpites" ] && echo "  $fotos foto(s)"
echo

if [ "$palpites" = "0" ] && [ "$fotos" = "0" ]; then
  echo "Já está tudo zerado. Não fiz nada."
  exit 0
fi

# ---------- a senha, sem deixar rastro no histórico ----------
SENHA="${ADMIN_TOKEN:-}"
if [ "$O_QUE" != "fotos" ] && [ -z "$SENHA" ]; then
  read -rsp "Senha do apagar (ADMIN_TOKEN): " SENHA
  echo
fi

# ---------- confirmação que não se dá por acidente ----------
echo "Isto apaga $O_QUE, para todo mundo, e não tem desfazer."
read -rp "Digite ZERAR para continuar: " resposta
if [ "$resposta" != "ZERAR" ]; then
  echo "Cancelado. Nada foi tocado."
  exit 0
fi

# ---------- a cópia, antes de qualquer estrago ----------
copia="copias/zerado-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$copia"
echo
echo "Guardando uma cópia em $copia..."

if [ "$O_QUE" != "fotos" ]; then
  curl -s --max-time 30 "$endereco/votos" > "$copia/palpites.json"
  echo "  palpites.json  ($(wc -c < "$copia/palpites.json" | tr -d ' ') bytes)"
fi

if [ "$O_QUE" != "palpites" ] && [ "$fotos" != "0" ]; then
  aws s3 sync "s3://$BUCKET" "$copia/fotos" --region "$REGIAO" --only-show-errors
  echo "  fotos/         ($(find "$copia/fotos" -type f 2>/dev/null | wc -l | tr -d ' ') arquivos)"
fi

# ---------- agora sim ----------
echo
if [ "$O_QUE" != "fotos" ]; then
  echo -n "Apagando os palpites... "
  if curl -s -f -X DELETE "$endereco/votos?senha=$SENHA" >/dev/null; then
    echo "ok"
  else
    echo "FALHOU (senha errada?). As fotos não foram tocadas."
    exit 1
  fi
fi

if [ "$O_QUE" != "palpites" ]; then
  echo -n "Apagando as fotos... "
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGIAO" --only-show-errors
  echo "ok"
fi

# ---------- confere ----------
sobrou_palpites=$(contar_palpites)
sobrou_fotos=$(contar_fotos)

echo
echo "Sobrou: $sobrou_palpites palpite(s), $sobrou_fotos foto(s)."
echo "A cópia está em $copia — não apague antes de conferir."
echo
echo "O painel na TV se acerta sozinho (4s os palpites, 15s as fotos)."
echo "Os tablets e os celulares ainda lembram o que fizeram: abra o site"
echo "neles com ?limpar=1 no fim do endereço para esquecerem."
