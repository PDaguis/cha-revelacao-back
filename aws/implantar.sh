#!/usr/bin/env bash
#
# Sobe a API dos palpites no Lambda, com os palpites no DynamoDB.
# Rodar de dentro da pasta do back:  ./aws/implantar.sh
#
# Precisa da AWS CLI configurada (aws configure). Pode rodar quantas vezes
# quiser: na primeira ele cria tudo, nas outras só atualiza o código.

set -euo pipefail

REGIAO="${REGIAO:-us-east-2}"   # a região liberada na nossa conta
FUNCAO="${FUNCAO:-cha-revelacao-api}"
TABELA="${TABELA:-cha-revelacao-votos}"
PAPEL="${PAPEL:-cha-revelacao-lambda}"
SITE="${SITE:-*}"                      # endereço do site na Vercel, para o CORS
SITE="${SITE%/}"                       # sem barra no fim: a origem que o navegador manda não tem
ADMIN_TOKEN="${ADMIN_TOKEN:-}"         # senha do DELETE; vazio desliga a rota

# ---------- confere o que precisa estar pronto ----------
if ! command -v aws >/dev/null 2>&1; then
  echo "A AWS CLI não está instalada."
  echo "No macOS:  brew install awscli"
  echo "Depois:    aws configure"
  exit 1
fi

if ! conta=$(aws sts get-caller-identity --query Account --output text 2>/dev/null); then
  echo "A AWS CLI está instalada, mas não está conectada na sua conta."
  echo "Rode:  aws configure"
  echo "Ela pede a Access Key e a Secret Key de um usuário do IAM."
  exit 1
fi

echo "Conta $conta, região $REGIAO."
echo "Vou criar (ou atualizar, se já existir):"
echo "  tabela  $TABELA  — onde os palpites ficam guardados"
echo "  papel   $PAPEL  — a permissão da função, só nessa tabela"
echo "  função  $FUNCAO  — a API"
echo "  um endereço HTTPS público para ela"
echo
[ "$SITE" = "*" ] && echo "Aviso: sem SITE, o CORS fica aberto para qualquer site." && echo

# ---------- 1. a tabela dos palpites ----------
if aws dynamodb describe-table --table-name "$TABELA" --region "$REGIAO" >/dev/null 2>&1; then
  echo "tabela $TABELA já existe"
else
  echo "criando a tabela $TABELA..."
  aws dynamodb create-table \
    --table-name "$TABELA" \
    --attribute-definitions AttributeName=chave,AttributeType=S \
    --key-schema AttributeName=chave,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGIAO" >/dev/null
  aws dynamodb wait table-exists --table-name "$TABELA" --region "$REGIAO"
fi

# ---------- 2. o papel que o Lambda usa ----------
if aws iam get-role --role-name "$PAPEL" >/dev/null 2>&1; then
  echo "papel $PAPEL já existe"
else
  echo "criando o papel $PAPEL..."
  aws iam create-role --role-name "$PAPEL" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }' >/dev/null
  aws iam attach-role-policy --role-name "$PAPEL" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "esperando o papel valer na AWS..."
  sleep 12
fi

# só o que a função precisa, e só na tabela dela
aws iam put-role-policy --role-name "$PAPEL" --policy-name palpites --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": [\"dynamodb:PutItem\", \"dynamodb:Scan\", \"dynamodb:BatchWriteItem\"],
    \"Resource\": \"arn:aws:dynamodb:$REGIAO:$conta:table/$TABELA\"
  }]
}"

# ---------- 3. o pacote ----------
echo "empacotando..."
rm -f /tmp/cha-revelacao-api.zip
zip -q /tmp/cha-revelacao-api.zip lambda.mjs regras.js armazens/dynamo.js package.json

# ---------- 4. a função ----------
ambiente="Variables={TABELA=$TABELA,CORS_ORIGIN=$SITE,ADMIN_TOKEN=$ADMIN_TOKEN}"

if aws lambda get-function --function-name "$FUNCAO" --region "$REGIAO" >/dev/null 2>&1; then
  echo "atualizando a função $FUNCAO..."
  aws lambda update-function-code --function-name "$FUNCAO" \
    --zip-file fileb:///tmp/cha-revelacao-api.zip --region "$REGIAO" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCAO" --region "$REGIAO"
  aws lambda update-function-configuration --function-name "$FUNCAO" \
    --environment "$ambiente" --region "$REGIAO" >/dev/null
else
  echo "criando a função $FUNCAO..."
  aws lambda create-function --function-name "$FUNCAO" \
    --runtime nodejs22.x \
    --role "arn:aws:iam::$conta:role/$PAPEL" \
    --handler lambda.handler \
    --timeout 10 \
    --memory-size 256 \
    --zip-file fileb:///tmp/cha-revelacao-api.zip \
    --environment "$ambiente" \
    --region "$REGIAO" >/dev/null
  aws lambda wait function-active --function-name "$FUNCAO" --region "$REGIAO"
fi

# ---------- 5. o endereço público ----------
# Nesta conta a Function URL pública é proibida pela organização (403 antes
# mesmo de a função rodar), então o endereço vem de um HTTP API do API Gateway.
# Sem configurar CORS aqui de propósito: quem responde os cabeçalhos é o
# próprio código, e duplicado o navegador recusa.
API_NOME="${API_NOME:-cha-revelacao}"

funcao_arn=$(aws lambda get-function --function-name "$FUNCAO" --region "$REGIAO" \
  --query Configuration.FunctionArn --output text)

api_id=$(aws apigatewayv2 get-apis --region "$REGIAO" \
  --query "Items[?Name=='$API_NOME'].ApiId | [0]" --output text)

if [ "$api_id" = "None" ] || [ -z "$api_id" ]; then
  echo "criando o API Gateway $API_NOME..."
  api_id=$(aws apigatewayv2 create-api --name "$API_NOME" --protocol-type HTTP \
    --target "$funcao_arn" --region "$REGIAO" --query ApiId --output text)
else
  echo "usando o API Gateway $API_NOME ($api_id)"
fi

# deixa o API Gateway chamar a função; se já puder, a AWS reclama e tudo bem
aws lambda add-permission --function-name "$FUNCAO" \
  --statement-id apigateway --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGIAO:$conta:$api_id/*/*" \
  --region "$REGIAO" >/dev/null 2>&1 || true

endereco="https://$api_id.execute-api.$REGIAO.amazonaws.com"

# ---------- 6. confere de fora, como o site vai chamar ----------
echo "conferindo o endereço..."
codigo="000"
for _ in 1 2 3; do
  codigo=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$endereco/votos" || echo "000")
  [ "$codigo" = "200" ] && break
  sleep 3
done

if [ "$codigo" != "200" ]; then
  echo
  echo "O endereço respondeu $codigo em vez de 200."
  echo "A função subiu, mas alguma coisa no caminho está bloqueando a chamada."
  exit 1
fi

echo
echo "API no ar: $endereco"
echo
echo "Ponha este endereço no config.js do front e publique de novo:"
echo
echo "  apiUrl: '$endereco',"
echo
if [ "$SITE" = "*" ]; then
  echo "Aviso: o CORS está aberto para qualquer site."
  echo "Rode de novo com SITE=https://seu-site.vercel.app para fechar."
fi
