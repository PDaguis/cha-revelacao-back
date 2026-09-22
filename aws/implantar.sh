#!/usr/bin/env bash
#
# Sobe a API dos palpites no Lambda, com os palpites no DynamoDB.
# Rodar de dentro da pasta do back:  ./aws/implantar.sh
#
# Precisa da AWS CLI configurada (aws configure). Pode rodar quantas vezes
# quiser: na primeira ele cria tudo, nas outras só atualiza o código.

set -euo pipefail

REGIAO="${REGIAO:-us-east-1}"
FUNCAO="${FUNCAO:-cha-revelacao-api}"
TABELA="${TABELA:-cha-revelacao-votos}"
PAPEL="${PAPEL:-cha-revelacao-lambda}"
SITE="${SITE:-*}"                      # endereço do site na Vercel, para o CORS
ADMIN_TOKEN="${ADMIN_TOKEN:-}"         # senha do DELETE; vazio desliga a rota

conta=$(aws sts get-caller-identity --query Account --output text)
echo "conta $conta, região $REGIAO"

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
# sem --cors de propósito: quem responde os cabeçalhos é o próprio código,
# senão eles vêm duplicados e o navegador recusa
if ! aws lambda get-function-url-config --function-name "$FUNCAO" --region "$REGIAO" >/dev/null 2>&1; then
  echo "criando o endereço público..."
  aws lambda create-function-url-config --function-name "$FUNCAO" \
    --auth-type NONE --region "$REGIAO" >/dev/null
  aws lambda add-permission --function-name "$FUNCAO" \
    --statement-id publico --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE --region "$REGIAO" >/dev/null
fi

endereco=$(aws lambda get-function-url-config --function-name "$FUNCAO" \
  --region "$REGIAO" --query FunctionUrl --output text)
endereco="${endereco%/}"

echo
echo "API no ar: $endereco"
echo
echo "Agora ponha este endereço no config.js do front e publique de novo:"
echo
echo "  apiUrl: '$endereco',"
echo
[ "$SITE" = "*" ] && echo "Aviso: o CORS está aberto para qualquer site. Rode de novo com
SITE=https://seu-site.vercel.app para fechar." || true
